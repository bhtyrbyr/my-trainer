-- AI gate: stop AI requests before Google's free-tier quota runs out, and tell the user why.
--
-- Limits come from Google AI Studio > Rate limit (free tier, 2026-10-26): Gemini 3.8 Flash
-- 5 RPM / 250K TPM / 20 RPD, Gemini 3.5 Flash Lite 15 RPM / 250K TPM / 500 RPD. The quota is shared
-- by every user of the app (one API key), so usage is counted from ai_usage_log across all users
-- (including the catalog translation script). Daily quotas reset at midnight Pacific time.
--
-- ai_reserve(): the single gate the Edge Function calls before a provider request. It checks, in
-- order: the user's daily limit, the app's daily cap, then which models still have Google quota
-- (per day and in the last minute). It counts the request and returns the usable models in
-- preference order, or raises a specific code the app explains to the user.
-- ai_availability(): the same decision without counting, for the client to show the status first.

update public.app_config
   set value = '{"gemini-3.8-flash": {"rpm": 5, "tpm": 250000, "rpd": 20}, "gemini-3.5-flash-lite": {"rpm": 15, "tpm": 250000, "rpd": 500}}'::jsonb
 where key = 'ai_model_limits';
insert into public.app_config (key, value) values ('ai_model_order', '["gemini-3.8-flash", "gemini-3.5-flash-lite"]'::jsonb)
on conflict (key) do nothing;

-- Per model: limits, use today (Pacific day) and in the last 60 seconds. Rows from 429 responses are
-- never logged (Google does not count them); failed requests are, because Google may.
create or replace function public.ai_model_status()
returns table (model text, rpd integer, rpm integer, tpm integer, used_today integer, used_minute integer, tokens_minute bigint, day_ok boolean, minute_ok boolean)
language sql stable security definer set search_path = public as $$
  with lim as (
    select o.model, o.ord,
           coalesce(((select value from public.app_config where key = 'ai_model_limits') -> o.model ->> 'rpd')::int, 0) as rpd,
           coalesce(((select value from public.app_config where key = 'ai_model_limits') -> o.model ->> 'rpm')::int, 0) as rpm,
           coalesce(((select value from public.app_config where key = 'ai_model_limits') -> o.model ->> 'tpm')::int, 0) as tpm
    from jsonb_array_elements_text(coalesce((select value from public.app_config where key = 'ai_model_order'), '[]'::jsonb)) with ordinality as o(model, ord)
  ),
  use as (
    select l.model,
           count(*) filter (where l.day_pt = (now() at time zone 'America/Los_Angeles')::date)::int as today,
           count(*) filter (where l.created_at > now() - interval '60 seconds')::int as minute,
           coalesce(sum(l.total_tokens) filter (where l.created_at > now() - interval '60 seconds'), 0)::bigint as tokens
    from public.ai_usage_log l
    where l.created_at > now() - interval '2 days'
    group by l.model
  )
  select lim.model, lim.rpd, lim.rpm, lim.tpm,
         coalesce(u.today, 0), coalesce(u.minute, 0), coalesce(u.tokens, 0),
         lim.rpd = 0 or coalesce(u.today, 0) < lim.rpd,
         (lim.rpm = 0 or coalesce(u.minute, 0) < lim.rpm) and (lim.tpm = 0 or coalesce(u.tokens, 0) < lim.tpm)
  from lim left join use u on u.model = lim.model
  order by lim.ord
$$;
revoke execute on function public.ai_model_status() from public, anon, authenticated;

-- The decision, shared by ai_availability() and ai_reserve().
create or replace function public.ai_decide(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_limit integer := coalesce((select ai_daily_limit from public.user_settings where user_id = p_user), 40);
  v_global integer := coalesce((select (value #>> '{}')::int from public.app_config where key = 'ai_global_daily_limit'), 200);
  v_used integer := coalesce((select request_count from public.ai_usage where user_id = p_user and day = current_date), 0);
  v_all integer := coalesce((select sum(request_count) from public.ai_usage where day = current_date), 0);
  v_istanbul_midnight timestamptz := (current_date + 1)::timestamp at time zone 'Europe/Istanbul';
  v_pacific_midnight timestamptz := (((now() at time zone 'America/Los_Angeles')::date + 1)::timestamp) at time zone 'America/Los_Angeles';
  v_models text[];
  v_any_day boolean;
begin
  select array_agg(s.model) filter (where s.day_ok and s.minute_ok), bool_or(s.day_ok)
    into v_models, v_any_day
  from public.ai_model_status() s;

  if v_used >= v_limit then
    return jsonb_build_object('available', false, 'reason', 'user_daily', 'resets_at', v_istanbul_midnight, 'user_left', 0);
  elsif v_all >= v_global then
    return jsonb_build_object('available', false, 'reason', 'app_daily', 'resets_at', v_istanbul_midnight, 'user_left', v_limit - v_used);
  elsif not coalesce(v_any_day, false) then
    return jsonb_build_object('available', false, 'reason', 'google_daily', 'resets_at', v_pacific_midnight, 'user_left', v_limit - v_used);
  elsif coalesce(array_length(v_models, 1), 0) = 0 then
    return jsonb_build_object('available', false, 'reason', 'google_minute', 'resets_at', now() + interval '60 seconds', 'user_left', v_limit - v_used);
  end if;
  return jsonb_build_object('available', true, 'reason', 'ok', 'models', to_jsonb(v_models), 'user_left', v_limit - v_used,
                            'google_resets_at', v_pacific_midnight);
end;
$$;
revoke execute on function public.ai_decide(uuid) from public, anon, authenticated;

-- Client: may I ask the AI right now, and if not, why and until when? (no counting)
create or replace function public.ai_availability()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_access() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return public.ai_decide(auth.uid());
end;
$$;
revoke execute on function public.ai_availability() from public, anon;
grant execute on function public.ai_availability() to authenticated;

-- Edge Function: gate + count one request. Raises AI_QUOTA (user), AI_APP_LIMIT, AI_GOOGLE_DAILY or
-- AI_GOOGLE_MINUTE; otherwise returns { models: [...usable, in order], user_left }.
create or replace function public.ai_reserve()
returns jsonb language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_user uuid := auth.uid();
  d jsonb;
begin
  if v_user is null or not public.can_access() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  -- serialize per user so two taps cannot both pass the last free slot
  insert into public.ai_usage (user_id, day, request_count) values (v_user, current_date, 0)
  on conflict (user_id, day) do nothing;
  perform 1 from public.ai_usage where user_id = v_user and day = current_date for update;

  d := public.ai_decide(v_user);
  if not (d ->> 'available')::boolean then
    raise exception '%', case d ->> 'reason'
      when 'user_daily' then 'AI_QUOTA'
      when 'app_daily' then 'AI_APP_LIMIT'
      when 'google_daily' then 'AI_GOOGLE_DAILY'
      else 'AI_GOOGLE_MINUTE' end
      using errcode = 'P0001';
  end if;
  update public.ai_usage set request_count = request_count + 1, updated_at = now() where user_id = v_user and day = current_date;
  return jsonb_build_object('models', d -> 'models', 'user_left', (d ->> 'user_left')::int - 1);
end;
$$;
revoke execute on function public.ai_reserve() from public, anon;
grant execute on function public.ai_reserve() to authenticated;
