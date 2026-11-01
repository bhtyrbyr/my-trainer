-- =============================================================================
-- Security hardening (audit 2026-11-01). Items refer to the audit findings.
--   1  can_access() is false without a profile; can_onboard() covers the onboarding writes only
--   2  profiles readable by owner/admin only; get_public_profile() / is_username_available()
--   3  avatar object names, progress-photos byte cap + 2 MB file limit
--   4  record_consent: access check, dedupe, daily cap
--   5  register_push: push-service host allow-list
--   6  profiles guard keeps created_at and username_changed_at
--   7  error_reports insert requires a non-blocked user
--   8  AI quota for 25+ users (limits, global lock, reserve-time counting)
--   9  nightly retention job (operational logs only, never user content)
--   10 monthly push counter, ops_health()
--   11 policies call (select auth.uid()) / (select public.can_access()) once per statement
--   12 lower() e-mail compare, leaderboard self row + all-time from total_points
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Access helpers
-- -----------------------------------------------------------------------------
create or replace function public.can_access()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and coalesce(
       (select p.status = 'approved' and not p.is_blocked from public.profiles p where p.user_id = auth.uid()),
       false)
$$;

-- Onboarding only: signed in, not blocked, and either no profile yet or an own pending profile.
create or replace function public.can_onboard()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and coalesce(
       (select p.status = 'pending' and not p.is_blocked from public.profiles p where p.user_id = auth.uid()),
       true)
$$;
revoke all on function public.can_onboard() from public, anon;
-- Used inside RLS policies, which run as the caller.
grant execute on function public.can_onboard() to authenticated, service_role;

-- profiles: owner (any status, so pending/rejected users see their waiting screen) or admin.
drop policy if exists "profiles_public_read" on public.profiles;
drop policy if exists "profiles_owner_or_admin_read" on public.profiles;
create policy "profiles_owner_or_admin_read" on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.can_onboard()));

-- profile_private: full owner access when approved; select/insert/update while onboarding (upsert).
drop policy if exists "profile_private_onboard_select" on public.profile_private;
create policy "profile_private_onboard_select" on public.profile_private for select to authenticated
  using (user_id = (select auth.uid()) and (select public.can_onboard()));
drop policy if exists "profile_private_onboard_insert" on public.profile_private;
create policy "profile_private_onboard_insert" on public.profile_private for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.can_onboard()));
drop policy if exists "profile_private_onboard_update" on public.profile_private;
create policy "profile_private_onboard_update" on public.profile_private for update to authenticated
  using (user_id = (select auth.uid()) and (select public.can_onboard()))
  with check (user_id = (select auth.uid()) and (select public.can_onboard()));

-- -----------------------------------------------------------------------------
-- 2. Public profile + username availability (definer RPCs, public fields only)
-- -----------------------------------------------------------------------------
create or replace function public.get_public_profile(p_user uuid)
returns table (
  display_name text, username text, avatar_path text, level integer,
  total_points integer, current_streak integer, created_at timestamptz
)
language plpgsql stable security definer set search_path = public set "TimeZone" = 'Europe/Istanbul' as $$
begin
  if auth.uid() is null or not public.can_access() or p_user is null then return; end if;
  return query
    select p.display_name, p.username::text, p.avatar_path, p.level, p.total_points,
           public.effective_streak(p.current_streak, p.last_active_on), p.created_at
    from public.profiles p
    where p.user_id = p_user
      and not p.is_blocked and p.status = 'approved' and p.onboarding_completed_at is not null
      and (p.show_on_leaderboard or p.user_id = auth.uid());
end;
$$;

create or replace function public.is_username_available(p_username text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.can_access() or public.can_onboard()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_username is null or lower(p_username) !~ '^[a-z0-9_]{3,20}$' then return false; end if;
  return not exists (
    select 1 from public.profiles p where p.username = lower(p_username)::citext and p.user_id <> auth.uid()
  );
end;
$$;

revoke all on function public.get_public_profile(uuid), public.is_username_available(text) from public, anon;
grant execute on function public.get_public_profile(uuid), public.is_username_available(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Storage
-- -----------------------------------------------------------------------------
drop policy if exists "avatars_owner_insert" on storage.objects;
create policy "avatars_owner_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and name ~ ('^' || (select auth.uid())::text || '/avatar\.(jpg|webp)$')
    and ((select public.can_access()) or (select public.can_onboard()))
  );
drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and ((select public.can_access()) or (select public.can_onboard()))
  )
  with check (
    bucket_id = 'avatars'
    and name ~ ('^' || (select auth.uid())::text || '/avatar\.(jpg|webp)$')
    and ((select public.can_access()) or (select public.can_onboard()))
  );

-- Bytes the caller already stores in progress-photos (policy helper, like the object count).
create or replace function public.progress_photo_bytes()
returns bigint language sql stable security definer set search_path = public, storage as $$
  select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0)::bigint
  from storage.objects o
  where o.bucket_id = 'progress-photos' and o.owner_id = auth.uid()::text
$$;
revoke all on function public.progress_photo_bytes() from public, anon;
grant execute on function public.progress_photo_bytes() to authenticated, service_role;

drop policy if exists "progress_photos_owner_insert" on storage.objects;
create policy "progress_photos_owner_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(img|thumb)\.bin$')
    and (select public.progress_photo_object_count()) < 1000
    and (select public.progress_photo_bytes()) < 157286400  -- 150 MB per user
    and (select public.can_access())
    and (select public.has_health_consent())
  );

update storage.buckets set file_size_limit = 2097152 where id = 'progress-photos';

-- -----------------------------------------------------------------------------
-- 4. record_consent
-- -----------------------------------------------------------------------------
create or replace function public.record_consent(p_kind text, p_version text)
returns void language plpgsql security definer set search_path = public set "TimeZone" = 'Europe/Istanbul' as $$
declare
  v_uid uuid := auth.uid();
  v_version text := left(p_version, 20);
  v_last public.user_consents%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_kind not in ('privacy_notice', 'health_data', 'adult', 'ai_processing') then
    raise exception 'BAD_KIND' using errcode = '22023';
  end if;
  if not (public.can_access() or (p_kind = 'privacy_notice' and public.can_onboard())) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_kind in ('adult', 'ai_processing')
     and exists (select 1 from public.profile_private
                  where user_id = v_uid and birth_year > extract(year from current_date)::int - 18) then
    raise exception 'UNDERAGE' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('consent:' || v_uid::text, 0));
  select * into v_last from public.user_consents
   where user_id = v_uid and kind = p_kind order by id desc limit 1;
  if found and v_last.version = v_version and v_last.granted then
    return;  -- nothing changed
  end if;
  if (select count(*) from public.user_consents
       where user_id = v_uid and created_at >= current_date::timestamptz) >= 20 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  insert into public.user_consents (user_id, kind, version, granted) values (v_uid, p_kind, v_version, true);
end;
$$;
revoke all on function public.record_consent(text, text) from public, anon;
grant execute on function public.record_consent(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. register_push: only real push services
-- -----------------------------------------------------------------------------
create or replace function public.register_push(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_host text;
begin
  if uid is null or not public.can_access() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_endpoint is null or char_length(p_endpoint) > 1000 or p_endpoint !~ '^https://[^[:space:]]+$' then
    raise exception 'BAD_ENDPOINT' using errcode = '22023';
  end if;
  v_host := lower(substring(p_endpoint from '^https://([^/:?#@]+)(?:[/:?#]|$)'));
  if v_host is null or not (
       v_host = 'fcm.googleapis.com'
    or v_host ~ '^[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com$'
    or v_host = 'updates.push.services.mozilla.com'
    or v_host ~ '^[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com$') then
    raise exception 'BAD_ENDPOINT' using errcode = '22023';
  end if;
  -- Browser keys are base64url (base64 tolerated): p256dh 65 bytes, auth 16 bytes.
  if p_p256dh is null or char_length(p_p256dh) not between 1 and 200 or p_p256dh !~ '^[A-Za-z0-9_+/-]+=*$'
     or p_auth is null or char_length(p_auth) not between 1 and 100 or p_auth !~ '^[A-Za-z0-9_+/-]+=*$' then
    raise exception 'BAD_KEY' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('push:' || uid::text, 0));
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at)
  values (uid, p_endpoint, p_p256dh, p_auth, nullif(left(btrim(coalesce(p_user_agent, '')), 300), ''), clock_timestamp());
  delete from public.push_subscriptions s
   where s.user_id = uid
     and s.id not in (select k.id from public.push_subscriptions k where k.user_id = uid
                       order by k.created_at desc, k.id limit 10);
end;
$$;
revoke all on function public.register_push(text, text, text, text) from public, anon;
grant execute on function public.register_push(text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. profiles guard: created_at and username_changed_at are not client-editable
-- -----------------------------------------------------------------------------
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  bootstrap text := (select value #>> '{}' from public.app_config where key = 'admin_bootstrap_email');
  admin_exists boolean := exists (select 1 from public.profiles where role = 'admin');
  require_approval boolean := coalesce((select (value #>> '{}')::boolean from public.app_config where key = 'require_approval'), true);
begin
  if tg_op = 'INSERT' then
    new.total_points := 0;
    new.current_streak := 0;
    new.longest_streak := 0;
    new.last_active_on := null;
    new.is_blocked := false;
    new.username := lower(new.username);
    new.created_at := now();
    new.username_changed_at := null;
    if (bootstrap <> '' and public.jwt_email() = lower(bootstrap)) or (bootstrap = '' and not admin_exists) then
      new.role := 'admin';
    else
      new.role := 'user';
    end if;
    if new.role = 'admin' or not require_approval then
      new.status := 'approved';
      new.status_changed_at := now();
    else
      new.status := 'pending';
      new.status_changed_at := null;
    end if;
    new.status_changed_by := null;
    return new;
  end if;

  -- UPDATE
  if not public.is_internal() then
    new.total_points := old.total_points;
    new.current_streak := old.current_streak;
    new.longest_streak := old.longest_streak;
    new.last_active_on := old.last_active_on;
    new.status := old.status;
    new.status_changed_at := old.status_changed_at;
    new.status_changed_by := old.status_changed_by;
  end if;
  if not public.is_admin() then
    new.role := old.role;
    new.is_blocked := old.is_blocked;
  end if;
  new.created_at := old.created_at;
  if new.username is distinct from old.username then
    if old.username_changed_at is not null and old.username_changed_at > now() - interval '30 days' then
      raise exception 'USERNAME_COOLDOWN' using errcode = 'P0001';
    end if;
    new.username := lower(new.username);
    new.username_changed_at := now();
  else
    new.username_changed_at := old.username_changed_at;
  end if;
  new.user_id := old.user_id;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. error_reports: blocked users cannot write
-- -----------------------------------------------------------------------------
drop policy if exists "error_reports_insert_own" on public.error_reports;
create policy "error_reports_insert_own" on public.error_reports for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and not exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.is_blocked)
  );

-- -----------------------------------------------------------------------------
-- 8. AI quota sized for 25+ users
-- -----------------------------------------------------------------------------
alter table public.user_settings alter column ai_daily_limit set default 10;
select set_config('app.internal', 'on', false);
update public.user_settings set ai_daily_limit = 10 where ai_daily_limit = 40;
select set_config('app.internal', 'off', false);
update public.app_config set value = '450'::jsonb, updated_at = now() where key = 'ai_global_daily_limit';

-- Reservation timestamps (no user id): the per-minute gate counts requests when they are reserved,
-- not when the Edge Function logs them afterwards.
create table if not exists private.ai_reservations (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);
create index if not exists ai_reservations_created_idx on private.ai_reservations (created_at);
revoke all on private.ai_reservations from public, anon, authenticated;

create or replace function public.ai_decide(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public set "TimeZone" = 'Europe/Istanbul' as $$
declare
  v_limit integer := coalesce((select ai_daily_limit from public.user_settings where user_id = p_user), 10);
  v_global integer := coalesce((select (value #>> '{}')::int from public.app_config where key = 'ai_global_daily_limit'), 450);
  v_used integer := coalesce((select request_count from public.ai_usage where user_id = p_user and day = current_date), 0);
  -- request_count is incremented by ai_reserve(), so this counts reservations.
  v_all integer := coalesce((select sum(request_count) from public.ai_usage where day = current_date), 0);
  v_reserved_minute integer := (select count(*) from private.ai_reservations where created_at > now() - interval '60 seconds');
  v_istanbul_midnight timestamptz := (current_date + 1)::timestamp at time zone 'Europe/Istanbul';
  v_pacific_midnight timestamptz := (((now() at time zone 'America/Los_Angeles')::date + 1)::timestamp) at time zone 'America/Los_Angeles';
  v_models text[];
  v_any_day boolean;
  v_minute_capacity integer;
begin
  select array_agg(s.model) filter (where s.day_ok and s.minute_ok), bool_or(s.day_ok),
         case when bool_or(s.day_ok and s.rpm = 0) then null else sum(s.rpm) filter (where s.day_ok) end
    into v_models, v_any_day, v_minute_capacity
  from public.ai_model_status() s;

  if v_used >= v_limit then
    return jsonb_build_object('available', false, 'reason', 'user_daily', 'resets_at', v_istanbul_midnight, 'user_left', 0);
  elsif v_all >= v_global then
    return jsonb_build_object('available', false, 'reason', 'app_daily', 'resets_at', v_istanbul_midnight, 'user_left', v_limit - v_used);
  elsif not coalesce(v_any_day, false) then
    return jsonb_build_object('available', false, 'reason', 'google_daily', 'resets_at', v_pacific_midnight, 'user_left', v_limit - v_used);
  elsif coalesce(array_length(v_models, 1), 0) = 0
     or (v_minute_capacity is not null and v_reserved_minute >= v_minute_capacity) then
    return jsonb_build_object('available', false, 'reason', 'google_minute', 'resets_at', now() + interval '60 seconds', 'user_left', v_limit - v_used);
  end if;
  return jsonb_build_object('available', true, 'reason', 'ok', 'models', to_jsonb(v_models), 'user_left', v_limit - v_used,
                            'google_resets_at', v_pacific_midnight);
end;
$$;
revoke all on function public.ai_decide(uuid) from public, anon, authenticated;

create or replace function public.ai_reserve()
returns jsonb language plpgsql security definer set search_path = public set "TimeZone" = 'Europe/Istanbul' as $$
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
  -- One reservation at a time app-wide, so the app-wide and per-minute budgets cannot be overshot.
  perform pg_advisory_xact_lock(hashtext('ai_reserve'));
  insert into public.ai_usage (user_id, day, request_count) values (v_user, current_date, 0)
  on conflict (user_id, day) do nothing;

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
  insert into private.ai_reservations default values;
  return jsonb_build_object('models', d -> 'models', 'user_left', (d ->> 'user_left')::int - 1);
end;
$$;
revoke all on function public.ai_reserve() from public, anon;
grant execute on function public.ai_reserve() to authenticated;

-- -----------------------------------------------------------------------------
-- 9. Nightly retention (operational logs only; user content is never deleted here)
-- -----------------------------------------------------------------------------
create or replace function private.run_retention()
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  n_reports integer; n_ai integer; n_cron integer; n_res integer;
begin
  delete from public.error_reports
   where status = 'resolved' and coalesce(resolved_at, created_at) < now() - interval '90 days';
  get diagnostics n_reports = row_count;
  delete from public.ai_usage_log where created_at < now() - interval '180 days';
  get diagnostics n_ai = row_count;
  delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '14 days';
  get diagnostics n_cron = row_count;
  delete from private.ai_reservations where created_at < now() - interval '1 day';
  get diagnostics n_res = row_count;
  return jsonb_build_object('error_reports', n_reports, 'ai_usage_log', n_ai, 'cron_runs', n_cron, 'ai_reservations', n_res);
end;
$$;
revoke all on function private.run_retention() from public, anon, authenticated;

select cron.schedule('nightly-retention', '30 1 * * *', 'select private.run_retention()');

-- -----------------------------------------------------------------------------
-- 10. Monitoring: monthly push counter, ops_health()
-- -----------------------------------------------------------------------------
create table if not exists private.push_monthly (
  month date primary key,
  sent bigint not null default 0
);
revoke all on private.push_monthly from public, anon, authenticated;

create or replace function public.dispatch_reminders()
returns integer language plpgsql security definer set search_path = public set "TimeZone" = 'Europe/Istanbul' as $$
declare
  v_url text;
  v_secret text;
  v_local timestamp := now() at time zone 'Europe/Istanbul';
  v_day date := v_local::date;
  v_to time := v_local::time;
  v_from time := case when v_local::time < time '00:05' then time '00:00' else v_local::time - interval '5 minutes' end;
  v_users jsonb;
  v_batch record;
  v_count integer := 0;
begin
  select c.function_url, c.secret into v_url, v_secret from private.push_config c where c.id;
  if v_url is null or v_secret is null then
    return 0;
  end if;

  delete from private.reminder_log where day < v_day - 7;

  with due as (
    select d.user_id, d.ref, d.label, d.remind_at
      from private.reminders_due(v_day, v_from, v_to) d
     where exists (select 1 from public.push_subscriptions s where s.user_id = d.user_id)
       and exists (select 1 from public.profiles p
                    where p.user_id = d.user_id and p.status = 'approved' and not p.is_blocked)
  ), fresh as (
    insert into private.reminder_log (user_id, ref, day)
    select due.user_id, due.ref, v_day from due
    on conflict do nothing
    returning reminder_log.user_id, reminder_log.ref
  ), per_user as (
    select due.user_id, array_agg(due.label order by due.remind_at, due.label, due.ref) as labels
      from due join fresh on fresh.user_id = due.user_id and fresh.ref = due.ref
     group by due.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', u.user_id,
           'payload', jsonb_build_object(
             'body', array_to_string(u.labels[1:3], ', ')
                     || case when cardinality(u.labels) > 3 then ' +' || (cardinality(u.labels) - 3)::text else '' end,
             'url', '/track',
             'tag', 'reminders-' || v_day::text))), '[]'::jsonb)
    into v_users
    from per_user u;

  if jsonb_array_length(v_users) = 0 then
    return 0;
  end if;

  for v_batch in
    select jsonb_agg(m.msg order by m.rn) as msgs, count(*)::int as n
      from (select row_number() over (order by u.user_id, s.created_at, s.id) - 1 as rn,
                   jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'payload', u.payload) as msg
              from jsonb_to_recordset(v_users) as u(user_id uuid, payload jsonb)
              join public.push_subscriptions s on s.user_id = u.user_id) m
     group by m.rn / 100
     order by m.rn / 100
  loop
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('messages', v_batch.msgs),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret),
      timeout_milliseconds := 30000
    );
    v_count := v_count + v_batch.n;
  end loop;

  if v_count > 0 then
    insert into private.push_monthly (month, sent) values (date_trunc('month', v_day)::date, v_count)
    on conflict (month) do update set sent = private.push_monthly.sent + excluded.sent;
  end if;

  update public.push_subscriptions s set last_used_at = now()
   where s.user_id in (select (e ->> 'user_id')::uuid from jsonb_array_elements(v_users) e);

  return v_count;
end;
$$;
revoke all on function public.dispatch_reminders() from public, anon, authenticated;

create or replace function public.admin_usage_summary()
returns jsonb language plpgsql stable security definer set search_path = public set "TimeZone" = 'Europe/Istanbul' as $$
declare
  v_month_start timestamptz := date_trunc('month', now());
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'storage', coalesce((
      select jsonb_object_agg(bucket_id, bytes)
      from (select o.bucket_id, sum(coalesce((o.metadata ->> 'size')::bigint, 0)) as bytes
            from storage.objects o group by o.bucket_id) b), '{}'::jsonb),
    'users_total', (select count(*) from public.profiles where onboarding_completed_at is not null),
    'users_active_7d', (select count(*) from public.profiles where last_active_on >= current_date - 6),
    'ai_calls_month', (select count(*) from public.ai_usage_log where created_at >= v_month_start),
    'push_month', coalesce((select sent from private.push_monthly where month = v_month_start::date), 0),
    'month_start', v_month_start
  );
end;
$$;
revoke all on function public.admin_usage_summary() from public, anon;
grant execute on function public.admin_usage_summary() to authenticated;

create or replace function public.ops_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'storage_bytes', (select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0) from storage.objects o),
    'failed_cron_24h', (select count(*) from cron.job_run_details
                         where status = 'failed' and start_time > now() - interval '24 hours'),
    'http_errors_24h', (select count(*) from net._http_response
                         where created > now() - interval '24 hours'
                           and (error_msg is not null or status_code is null or status_code >= 400)),
    'open_error_reports', (select count(*) from public.error_reports where status = 'open')
  );
end;
$$;
revoke all on function public.ops_health() from public, anon, authenticated;
grant execute on function public.ops_health() to service_role;

-- -----------------------------------------------------------------------------
-- 12. Small fixes
-- -----------------------------------------------------------------------------
create or replace function public.enforce_access_mode()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  mode text := coalesce((select value #>> '{}' from public.app_config where key = 'access_mode'), 'open');
begin
  if mode = 'invite' then
    if new.email is null
       or not exists (select 1 from public.allowed_emails a where lower(a.email::text) = lower(new.email)) then
      raise exception 'ACCESS_DENIED: % is not on the invite list', coalesce(new.email, '<null>')
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- Hidden users still see their own row (ranked against the visible field); all-time reads total_points.
create or replace function public.get_leaderboard(p_period text default 'week', p_limit integer default 50)
returns table (
  rank bigint, user_id uuid, username text, display_name text, avatar_path text,
  points bigint, level integer, active_days bigint, streak integer, is_me boolean
)
language plpgsql stable security definer set search_path = public set "TimeZone" = 'Europe/Istanbul' as $$
declare
  d_from date;
  d_to date := current_date + 1;
  v_me uuid := auth.uid();
begin
  if not public.can_access() then return; end if;

  if p_period not in ('week', 'month') then
    return query
    with ranked as (
      select
        dense_rank() over (order by p.total_points desc, p.created_at asc) as rank,
        p.user_id, p.username::text as username, p.display_name, p.avatar_path, p.total_points::bigint as points, p.level,
        public.effective_streak(p.current_streak, p.last_active_on) as streak,
        (p.user_id = v_me) as is_me
      from public.profiles p
      where (p.show_on_leaderboard or p.user_id = v_me)
        and not p.is_blocked and p.status = 'approved' and p.onboarding_completed_at is not null
        and (p.total_points > 0 or p.user_id = v_me)
    ), top as (
      select * from ranked r where r.rank <= p_limit or r.is_me
      order by r.rank, r.display_name
      limit p_limit + 1
    )
    select t.rank, t.user_id, t.username, t.display_name, t.avatar_path, t.points, t.level,
           (select count(distinct e.occurred_on) from public.point_events e where e.user_id = t.user_id)::bigint,
           t.streak, t.is_me
    from top t
    order by t.rank, t.display_name;
    return;
  end if;

  d_from := case p_period
    when 'week'  then date_trunc('week', current_date)::date
    else date_trunc('month', current_date)::date
  end;
  return query
  with scores as (
    select e.user_id, sum(e.points)::bigint as points, count(distinct e.occurred_on)::bigint as active_days
    from public.point_events e
    where e.occurred_on >= d_from and e.occurred_on < d_to
    group by e.user_id
  ),
  ranked as (
    select
      dense_rank() over (order by s.points desc, p.created_at asc) as rank,
      p.user_id, p.username::text, p.display_name, p.avatar_path, s.points, p.level, s.active_days,
      public.effective_streak(p.current_streak, p.last_active_on) as streak,
      (p.user_id = v_me) as is_me
    from scores s
    join public.profiles p on p.user_id = s.user_id
    where (p.show_on_leaderboard or p.user_id = v_me)
      and not p.is_blocked and p.status = 'approved' and p.onboarding_completed_at is not null
  )
  select * from ranked r where r.rank <= p_limit or r.is_me
  order by r.rank, r.display_name
  limit p_limit + 1;
end;
$$;
revoke all on function public.get_leaderboard(text, integer) from public, anon;
grant execute on function public.get_leaderboard(text, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 11. Policies evaluate auth.uid() and the access helpers once per statement (InitPlan), not per row.
--     Rewrites every policy in public and on storage.objects; idempotent (already wrapped calls deparse
--     as "( SELECT auth.uid() AS uid)" and are skipped by the lookbehind).
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
  v_qual text;
  v_check text;
  v_sql text;
begin
  perform set_config('search_path', 'public, extensions', true);
  for r in
    select n.nspname, c.relname, p.polname,
           pg_get_expr(p.polqual, p.polrelid) as qual,
           pg_get_expr(p.polwithcheck, p.polrelid) as wcheck
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' or (n.nspname = 'storage' and c.relname = 'objects')
  loop
    v_qual := r.qual;
    v_check := r.wcheck;
    v_qual := regexp_replace(v_qual, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'g');
    v_check := regexp_replace(v_check, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'g');
    v_qual := regexp_replace(v_qual, '(?<!SELECT )(?<![.\w])(can_access|is_admin|can_onboard|has_onboarded)\(\)', '(select public.\1())', 'g');
    v_check := regexp_replace(v_check, '(?<!SELECT )(?<![.\w])(can_access|is_admin|can_onboard|has_onboarded)\(\)', '(select public.\1())', 'g');
    if v_qual is distinct from r.qual or v_check is distinct from r.wcheck then
      v_sql := format('alter policy %I on %I.%I', r.polname, r.nspname, r.relname);
      if v_qual is not null then v_sql := v_sql || format(' using (%s)', v_qual); end if;
      if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
      execute v_sql;
    end if;
  end loop;
end;
$$;
