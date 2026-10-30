-- Product decision (2026-10-30): people under 18 may use the app; only the AI features are 18+
-- (Gemini / OpenRouter terms). Replaces the sign-up age guard of 20261105010000.
drop trigger if exists profile_private_age_guard on public.profile_private;
drop function if exists public.profile_private_age_guard();

-- record_consent (20261105010000) keeps refusing 'adult' / 'ai_processing' for a stored birth year under 18.

-- The AI gate also checks the age on every request (a birth year changed after consent counts).
create or replace function public.ai_reserve()
returns jsonb language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_user uuid := auth.uid();
  d jsonb;
begin
  if v_user is null or not public.can_access() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if exists (select 1 from public.profile_private
              where user_id = v_user and birth_year > extract(year from current_date)::int - 18) then
    raise exception 'AI_UNDERAGE' using errcode = 'P0001';
  end if;
  if not public.ai_consent_of(v_user) then
    raise exception 'AI_CONSENT_REQUIRED' using errcode = 'P0001';
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
