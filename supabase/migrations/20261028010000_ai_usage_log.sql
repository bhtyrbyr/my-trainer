-- AI usage log for the admin dashboard: who used how many tokens, when, on which model.
--
-- Google does not expose the remaining free-tier quota through the API, so every provider call is
-- logged here and compared with the limits the admin copies from Google AI Studio
-- (app_config.ai_model_limits). Gemini's per-day quotas (RPD) reset at midnight Pacific time, so
-- rows carry the Pacific calendar day (day_pt).
--
-- Writes: the ai-coach Edge Function via ai_log_usage() with the caller's token; the catalog sync
-- script (service role) with user_id null. Reads: admins only, via admin_ai_usage()/admin_ai_live().
-- Only counts are stored, never prompts, photos or answers.

create table if not exists public.ai_usage_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  day_pt date not null default ((now() at time zone 'America/Los_Angeles')::date),
  action text not null check (action in ('food_estimate_text', 'food_estimate_photo', 'catalog_translate', 'coach_chat')),
  provider text not null check (provider in ('gemini', 'openrouter')),
  model text not null check (char_length(model) between 1 and 100),
  prompt_tokens integer not null default 0 check (prompt_tokens between 0 and 10000000),
  output_tokens integer not null default 0 check (output_tokens between 0 and 10000000),
  total_tokens integer not null default 0 check (total_tokens between 0 and 10000000),
  ok boolean not null default true
);
create index if not exists ai_usage_log_day_idx on public.ai_usage_log (day_pt desc);
create index if not exists ai_usage_log_recent_idx on public.ai_usage_log (created_at desc);

alter table public.ai_usage_log enable row level security;
-- no policies: clients never read or write the table directly

-- Free-tier limits per model, as shown in Google AI Studio > Rate limit (admin-editable).
insert into public.app_config (key, value) values (
  'ai_model_limits',
  '{"gemini-3.8-flash": {"rpm": 10, "tpm": 250000, "rpd": 250}, "gemini-3.5-flash-lite": {"rpm": 15, "tpm": 250000, "rpd": 1000}}'::jsonb
) on conflict (key) do nothing;

create or replace function public.ai_log_usage(
  p_action text,
  p_provider text,
  p_model text,
  p_prompt_tokens integer,
  p_output_tokens integer,
  p_total_tokens integer,
  p_ok boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_access() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_action not in ('food_estimate_text', 'food_estimate_photo', 'coach_chat') then
    raise exception 'BAD_ACTION' using errcode = '22023';
  end if;
  insert into public.ai_usage_log (user_id, action, provider, model, prompt_tokens, output_tokens, total_tokens, ok)
  values (
    auth.uid(), p_action, p_provider, left(p_model, 100),
    least(greatest(coalesce(p_prompt_tokens, 0), 0), 1000000),
    least(greatest(coalesce(p_output_tokens, 0), 0), 1000000),
    least(greatest(coalesce(p_total_tokens, 0), 0), 1000000),
    coalesce(p_ok, true)
  );
end;
$$;
revoke execute on function public.ai_log_usage(text, text, text, integer, integer, integer, boolean) from public, anon;
grant execute on function public.ai_log_usage(text, text, text, integer, integer, integer, boolean) to authenticated;

-- Daily aggregates per user/action/model for the last p_days Pacific days. Admin only.
create or replace function public.admin_ai_usage(p_days integer default 30)
returns table (
  day_pt date,
  user_id uuid,
  username text,
  display_name text,
  action text,
  model text,
  requests integer,
  failed integer,
  prompt_tokens bigint,
  output_tokens bigint,
  total_tokens bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select l.day_pt, l.user_id, p.username::text, p.display_name, l.action, l.model,
           count(*)::int, count(*) filter (where not l.ok)::int,
           sum(l.prompt_tokens)::bigint, sum(l.output_tokens)::bigint, sum(l.total_tokens)::bigint
    from public.ai_usage_log l
    left join public.profiles p on p.user_id = l.user_id
    where l.day_pt > (now() at time zone 'America/Los_Angeles')::date - least(greatest(coalesce(p_days, 30), 1), 365)
    group by l.day_pt, l.user_id, p.username, p.display_name, l.action, l.model
    order by l.day_pt desc, sum(l.total_tokens) desc;
end;
$$;

-- Right-now view per model: today's Pacific-day totals and the last 60 seconds (RPM/TPM). Admin only.
create or replace function public.admin_ai_live()
returns table (model text, requests_today integer, tokens_today bigint, requests_last_minute integer, tokens_last_minute bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select l.model,
           count(*) filter (where l.day_pt = (now() at time zone 'America/Los_Angeles')::date)::int,
           coalesce(sum(l.total_tokens) filter (where l.day_pt = (now() at time zone 'America/Los_Angeles')::date), 0)::bigint,
           count(*) filter (where l.created_at > now() - interval '60 seconds')::int,
           coalesce(sum(l.total_tokens) filter (where l.created_at > now() - interval '60 seconds'), 0)::bigint
    from public.ai_usage_log l
    where l.created_at > now() - interval '2 days'
    group by l.model;
end;
$$;

revoke execute on function public.admin_ai_usage(integer), public.admin_ai_live() from public, anon;
grant execute on function public.admin_ai_usage(integer), public.admin_ai_live() to authenticated;

-- The app's own daily request budget (Istanbul day, see ai_consume) next to Google's. Admin only.
create or replace function public.admin_ai_app_today()
returns table (used integer, global_limit integer)
language plpgsql stable security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select coalesce((select sum(request_count) from public.ai_usage where day = current_date), 0)::int,
           coalesce((select (value #>> '{}')::int from public.app_config where key = 'ai_global_daily_limit'), 200);
end;
$$;
revoke execute on function public.admin_ai_app_today() from public, anon;
grant execute on function public.admin_ai_app_today() to authenticated;
