-- AI features stay, with the free-tier safeguards decided on 2026-10-30 (docs/LICENSING.md):
-- the user confirms being 18+ ('adult') and gives explicit consent to AI processing ('ai_processing')
-- before the first request; ai_reserve() refuses without it. Region and wording live in the client
-- and the ai-coach Edge Function.

alter table public.user_consents drop constraint if exists user_consents_kind_check;
alter table public.user_consents add constraint user_consents_kind_check
  check (kind in ('privacy_notice', 'health_data', 'adult', 'ai_processing'));

create or replace function public.record_consent(p_kind text, p_version text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where user_id = auth.uid() and is_blocked) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_kind not in ('privacy_notice', 'health_data', 'adult', 'ai_processing') then
    raise exception 'BAD_KIND' using errcode = '22023';
  end if;
  insert into public.user_consents (user_id, kind, version, granted) values (auth.uid(), p_kind, left(p_version, 20), true);
end;
$$;

-- Withdrawing AI consent needs no data deletion (only request counts are stored); health data has its
-- own withdraw_health_consent() because it erases entries.
create or replace function public.withdraw_ai_consent(p_version text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_access() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  insert into public.user_consents (user_id, kind, version, granted) values (auth.uid(), 'ai_processing', left(p_version, 20), false);
end;
$$;
revoke execute on function public.withdraw_ai_consent(text) from public, anon;
grant execute on function public.withdraw_ai_consent(text) to authenticated;

-- Internal: latest AI consent of a user (the newest row decides).
create or replace function public.ai_consent_of(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.granted from public.user_consents c
      where c.user_id = p_user and c.kind = 'ai_processing'
      order by c.id desc limit 1),
    false)
$$;
revoke execute on function public.ai_consent_of(uuid) from public, anon, authenticated;

-- The gate now also requires the consent.
create or replace function public.ai_reserve()
returns jsonb language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_user uuid := auth.uid();
  d jsonb;
begin
  if v_user is null or not public.can_access() then
    raise exception 'FORBIDDEN' using errcode = '42501';
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
