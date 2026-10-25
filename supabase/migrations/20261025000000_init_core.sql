-- =============================================================================
-- my-trainer / Faz 0: core identity, access control, profiles, points engine
-- See docs/PRD.md sections 1.4, 2.1 and 3.
--
-- Access model (multi-user):
--   * Google OAuth only. app_config.access_mode = 'open' (anyone) | 'invite' (allowed_emails).
--   * Every user table: RLS  user_id = auth.uid() and public.can_access()
--   * Cross-user visibility ONLY through public.profiles (public fields) and get_leaderboard().
--   * Points are written exclusively by security-definer functions (clients are read-only).
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- True while running inside our own security-definer functions (lets column-protection triggers
-- distinguish internal writes from client writes).
create or replace function public.is_internal()
returns boolean language sql stable as $$
  select coalesce(current_setting('app.internal', true), '') = 'on'
$$;

create or replace function public.jwt_email()
returns text language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- -----------------------------------------------------------------------------
-- app_config (admin-editable key/value)
-- -----------------------------------------------------------------------------
create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_config (key, value) values
  ('access_mode', '"open"'::jsonb),              -- "open" | "invite"
  ('ai_global_daily_limit', '200'::jsonb),       -- all users combined, protects the free Gemini quota
  ('admin_bootstrap_email', '""'::jsonb)         -- set in seed.sql; that account becomes admin on onboarding
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- allowed_emails (only enforced when access_mode = 'invite')
-- -----------------------------------------------------------------------------
create table if not exists public.allowed_emails (
  email citext primary key,
  note text,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- profiles: PUBLIC fields only (readable by every authenticated user)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username citext not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_path text not null check (char_length(avatar_path) > 0),
  role text not null default 'user' check (role in ('user', 'admin')),
  is_blocked boolean not null default false,
  show_on_leaderboard boolean not null default true,
  total_points integer not null default 0 check (total_points >= 0),
  level integer generated always as (total_points / 1000 + 1) stored,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  last_active_on date,
  onboarding_completed_at timestamptz,
  username_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profiles_points_idx on public.profiles (total_points desc);

-- profile_private: owner-only fields
create table if not exists public.profile_private (
  user_id uuid primary key references auth.users(id) on delete cascade,
  birth_year smallint check (birth_year is null or birth_year between 1900 and 2100),
  height_cm numeric(5,1) check (height_cm is null or height_cm between 50 and 300),
  sex text check (sex is null or sex in ('male', 'female', 'other')),
  goal text check (goal is null or goal in ('lose_fat', 'build_muscle', 'maintain', 'performance')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Access helpers (depend on profiles)
-- -----------------------------------------------------------------------------
create or replace function public.can_access()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and not coalesce((select p.is_blocked from public.profiles p where p.user_id = auth.uid()), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin' and not p.is_blocked
  )
$$;

create or replace function public.has_onboarded()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.onboarding_completed_at is not null and not p.is_blocked
  )
$$;

revoke all on function public.can_access(), public.is_admin(), public.has_onboarded(), public.is_internal(), public.jwt_email() from public;
grant execute on function public.can_access(), public.is_admin(), public.has_onboarded(), public.is_internal(), public.jwt_email() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RLS: app_config / allowed_emails / profiles / profile_private
-- -----------------------------------------------------------------------------
alter table public.app_config enable row level security;
drop policy if exists "app_config_read" on public.app_config;
create policy "app_config_read" on public.app_config for select to authenticated using (true);
drop policy if exists "app_config_admin_write" on public.app_config;
create policy "app_config_admin_write" on public.app_config for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.allowed_emails enable row level security;
drop policy if exists "allowed_emails_admin_all" on public.allowed_emails;
create policy "allowed_emails_admin_all" on public.allowed_emails for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "allowed_emails_self_read" on public.allowed_emails;
create policy "allowed_emails_self_read" on public.allowed_emails for select to authenticated
  using (email = public.jwt_email());

alter table public.profiles enable row level security;
drop policy if exists "profiles_public_read" on public.profiles;
create policy "profiles_public_read" on public.profiles for select to authenticated
  using (public.can_access());
drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles for insert to authenticated
  with check (user_id = auth.uid() and public.can_access());
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid());
drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- no client delete: use delete_my_account()

alter table public.profile_private enable row level security;
drop policy if exists "profile_private_owner_all" on public.profile_private;
create policy "profile_private_owner_all" on public.profile_private for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
drop trigger if exists profile_private_set_updated_at on public.profile_private;
create trigger profile_private_set_updated_at before update on public.profile_private
  for each row execute function public.set_updated_at();

-- Column protection: clients may never set role / is_blocked / points / streaks themselves.
-- Admins may change role and is_blocked. Internal functions (award_points) may change points/streaks.
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  bootstrap text := (select value #>> '{}' from public.app_config where key = 'admin_bootstrap_email');
  admin_exists boolean := exists (select 1 from public.profiles where role = 'admin');
begin
  if tg_op = 'INSERT' then
    new.total_points := 0;
    new.current_streak := 0;
    new.longest_streak := 0;
    new.last_active_on := null;
    new.is_blocked := false;
    new.username := lower(new.username);
    -- First admin: bootstrap email from config, or the very first profile if none configured.
    if (bootstrap <> '' and public.jwt_email() = lower(bootstrap)) or (bootstrap = '' and not admin_exists) then
      new.role := 'admin';
    else
      new.role := 'user';
    end if;
    return new;
  end if;

  -- UPDATE
  if not public.is_internal() then
    new.total_points := old.total_points;
    new.current_streak := old.current_streak;
    new.longest_streak := old.longest_streak;
    new.last_active_on := old.last_active_on;
  end if;
  if not public.is_admin() then
    new.role := old.role;
    new.is_blocked := old.is_blocked;
  end if;
  -- username change at most every 30 days
  if new.username is distinct from old.username then
    if old.username_changed_at is not null and old.username_changed_at > now() - interval '30 days' then
      raise exception 'USERNAME_COOLDOWN' using errcode = 'P0001';
    end if;
    new.username := lower(new.username);
    new.username_changed_at := now();
  end if;
  new.user_id := old.user_id;
  return new;
end;
$$;
drop trigger if exists profiles_protect_columns on public.profiles;
create trigger profiles_protect_columns before insert or update on public.profiles
  for each row execute function public.protect_profile_columns();

-- -----------------------------------------------------------------------------
-- auth.users hooks: invite-mode gate + settings bootstrap
-- -----------------------------------------------------------------------------
create or replace function public.enforce_access_mode()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  mode text := coalesce((select value #>> '{}' from public.app_config where key = 'access_mode'), 'open');
begin
  if mode = 'invite' then
    if new.email is null or not exists (select 1 from public.allowed_emails a where a.email = new.email) then
      raise exception 'ACCESS_DENIED: % is not on the invite list', coalesce(new.email, '<null>')
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_access_mode on auth.users;
create trigger enforce_access_mode before insert on auth.users
  for each row execute function public.enforce_access_mode();

-- -----------------------------------------------------------------------------
-- user_settings
-- -----------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  locale text not null default 'tr' check (locale in ('tr', 'en')),
  unit_weight text not null default 'kg' check (unit_weight in ('kg', 'lb')),
  unit_length text not null default 'cm' check (unit_length in ('cm', 'in')),
  daily_kcal integer check (daily_kcal is null or daily_kcal between 500 and 10000),
  daily_protein_g integer check (daily_protein_g is null or daily_protein_g between 0 and 1000),
  daily_water_ml integer not null default 2500 check (daily_water_ml between 500 and 10000),
  week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6),
  ai_provider text not null default 'gemini' check (ai_provider in ('gemini', 'openrouter', 'off')),
  ai_daily_limit integer not null default 40 check (ai_daily_limit between 0 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
drop policy if exists "user_settings_owner_all" on public.user_settings;
create policy "user_settings_owner_all" on public.user_settings for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());
drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Points engine (docs/PRD.md section 1.4)
-- -----------------------------------------------------------------------------
create table if not exists public.point_rules (
  kind text primary key,
  points integer not null,
  per_event_cap integer,          -- max points a single event may yield (after per-set / per-minute bonuses)
  daily_cap integer,              -- max points per day for this kind
  weekly_cap integer,             -- max points per ISO week for this kind
  counts_toward_daily_total boolean not null default true,
  is_active boolean not null default true,
  description text
);
insert into public.point_rules (kind, points, per_event_cap, daily_cap, weekly_cap, counts_toward_daily_total, description) values
  ('workout_strength',   50, 100, 200,  null, true,  '50 + 2 per set, max 100 per session, 2 sessions/day'),
  ('workout_cardio',     30,  60, 120,  null, true,  '30 + 1 per 5 min, max 60 per session'),
  ('personal_record',    20,  20, null, null, true,  'New PR, once per exercise per day (unique ref)'),
  ('weight_log',         10,  10,  10,  null, true,  'Body weight logged, once per day'),
  ('measurement_log',    15,  15, null,   15, true,  'Body measurements, once per week'),
  ('meal_log',            5,   5,  20,  null, true,  'Meal logged, max 4 per day'),
  ('protein_goal',       15,  15,  15,  null, true,  'Daily protein goal reached'),
  ('water_goal',         10,  10,  10,  null, true,  'Daily water goal reached'),
  ('sleep_log',           5,  10,  10,  null, true,  '5 + 5 if >= 7h'),
  ('habit_done',         10,  10,  50,  null, true,  'Habit completed, max 5 per day'),
  ('todo_done',           5,   5,  30,  null, true,  'Task completed, max 6 per day'),
  ('progress_photo',     25,  25, null,   25, true,  'Progress photo, once per week'),
  ('streak_7',           50,  50, null, null, false, 'Bonus every 7 consecutive active days'),
  ('streak_30',         250, 250, null, null, false, 'Bonus every 30 consecutive active days')
on conflict (kind) do nothing;

alter table public.point_rules enable row level security;
drop policy if exists "point_rules_read" on public.point_rules;
create policy "point_rules_read" on public.point_rules for select to authenticated using (true);
drop policy if exists "point_rules_admin_write" on public.point_rules;
create policy "point_rules_admin_write" on public.point_rules for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create table if not exists public.point_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null references public.point_rules(kind),
  points integer not null check (points >= 0),
  occurred_on date not null,
  ref_table text not null,
  ref_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, kind, ref_table, ref_id)
);
create index if not exists point_events_user_date_idx on public.point_events (user_id, occurred_on);
create index if not exists point_events_date_idx on public.point_events (occurred_on);
alter table public.point_events enable row level security;
drop policy if exists "point_events_owner_read" on public.point_events;
create policy "point_events_owner_read" on public.point_events for select to authenticated
  using (user_id = auth.uid() and public.can_access());
-- No insert/update/delete policies: writes only through award_points()/revoke_points().

-- Daily total cap across all kinds that count toward it
insert into public.app_config (key, value) values ('points_daily_total_cap', '300'::jsonb) on conflict (key) do nothing;

create or replace function public.award_points(
  p_user uuid,
  p_kind text,
  p_occurred_on date,
  p_ref_table text,
  p_ref_id text,
  p_points_override integer default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  r public.point_rules%rowtype;
  pts integer;
  used_today integer;
  used_week integer;
  total_today integer;
  total_cap integer := coalesce((select (value #>> '{}')::int from public.app_config where key = 'points_daily_total_cap'), 300);
  prof public.profiles%rowtype;
  inserted boolean;
begin
  select * into prof from public.profiles where user_id = p_user and onboarding_completed_at is not null and not is_blocked;
  if not found then return 0; end if;
  if p_occurred_on < current_date - 2 or p_occurred_on > current_date then return 0; end if; -- no backdating > 2 days

  select * into r from public.point_rules where kind = p_kind and is_active;
  if not found then return 0; end if;

  pts := coalesce(p_points_override, r.points);
  if r.per_event_cap is not null then pts := least(pts, r.per_event_cap); end if;

  if r.daily_cap is not null then
    select coalesce(sum(points), 0) into used_today from public.point_events
      where user_id = p_user and kind = p_kind and occurred_on = p_occurred_on;
    pts := least(pts, greatest(r.daily_cap - used_today, 0));
  end if;
  if r.weekly_cap is not null then
    select coalesce(sum(points), 0) into used_week from public.point_events
      where user_id = p_user and kind = p_kind
        and occurred_on >= date_trunc('week', p_occurred_on)::date
        and occurred_on <  (date_trunc('week', p_occurred_on) + interval '7 days')::date;
    pts := least(pts, greatest(r.weekly_cap - used_week, 0));
  end if;
  if r.counts_toward_daily_total then
    select coalesce(sum(e.points), 0) into total_today
      from public.point_events e join public.point_rules pr on pr.kind = e.kind
      where e.user_id = p_user and e.occurred_on = p_occurred_on and pr.counts_toward_daily_total;
    pts := least(pts, greatest(total_cap - total_today, 0));
  end if;

  -- Record the event even with 0 points so the "once per ref" rule holds; do nothing on duplicate.
  insert into public.point_events (user_id, kind, points, occurred_on, ref_table, ref_id)
  values (p_user, p_kind, pts, p_occurred_on, p_ref_table, p_ref_id)
  on conflict (user_id, kind, ref_table, ref_id) do nothing;
  get diagnostics inserted = row_count;
  if not inserted then return 0; end if;

  perform set_config('app.internal', 'on', true);

  -- Streak / activity bookkeeping (only for days that actually scored)
  if pts > 0 then
    if prof.last_active_on is null or p_occurred_on > prof.last_active_on then
      if prof.last_active_on = p_occurred_on - 1 then
        prof.current_streak := prof.current_streak + 1;
      else
        prof.current_streak := 1;
      end if;
      prof.last_active_on := p_occurred_on;
      prof.longest_streak := greatest(prof.longest_streak, prof.current_streak);
    end if;
  end if;

  update public.profiles set
    total_points   = total_points + pts,
    current_streak = prof.current_streak,
    longest_streak = prof.longest_streak,
    last_active_on = prof.last_active_on
  where user_id = p_user;

  -- Streak bonuses (not subject to the daily total cap). ref = streak day so it cannot double-fire.
  if pts > 0 and p_kind not in ('streak_7', 'streak_30') then
    if prof.current_streak % 30 = 0 then
      perform public.award_points(p_user, 'streak_30', p_occurred_on, 'streak', p_occurred_on::text);
    elsif prof.current_streak % 7 = 0 then
      perform public.award_points(p_user, 'streak_7', p_occurred_on, 'streak', p_occurred_on::text);
    end if;
  end if;

  perform set_config('app.internal', 'off', true);
  return pts;
end;
$$;

-- Called by module delete-triggers so deleting a workout/meal/etc. takes its points back.
create or replace function public.revoke_points(p_user uuid, p_ref_table text, p_ref_id text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  removed integer;
begin
  with d as (
    delete from public.point_events
    where user_id = p_user and ref_table = p_ref_table and ref_id = p_ref_id
    returning points
  ) select coalesce(sum(points), 0) into removed from d;
  if removed > 0 then
    perform set_config('app.internal', 'on', true);
    update public.profiles set total_points = greatest(total_points - removed, 0) where user_id = p_user;
    perform set_config('app.internal', 'off', true);
  end if;
  return removed;
end;
$$;

revoke all on function public.award_points(uuid, text, date, text, text, integer) from public;
revoke all on function public.revoke_points(uuid, text, text) from public;
-- Only service_role (and triggers, which run as the function owner) may call these directly.
grant execute on function public.award_points(uuid, text, date, text, text, integer) to service_role;
grant execute on function public.revoke_points(uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- Leaderboard RPC: top N for a period + the caller's own row. Public fields only.
-- -----------------------------------------------------------------------------
create or replace function public.get_leaderboard(p_period text default 'week', p_limit integer default 50)
returns table (
  rank bigint,
  user_id uuid,
  username text,
  display_name text,
  avatar_path text,
  points bigint,
  level integer,
  active_days bigint,
  is_me boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  d_from date;
  d_to date := current_date + 1;
begin
  if not public.can_access() then return; end if;
  d_from := case p_period
    when 'week'  then date_trunc('week', current_date)::date
    when 'month' then date_trunc('month', current_date)::date
    else date '1970-01-01'
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
      (p.user_id = auth.uid()) as is_me
    from scores s
    join public.profiles p on p.user_id = s.user_id
    where p.show_on_leaderboard and not p.is_blocked and p.onboarding_completed_at is not null
  )
  select * from ranked r where r.rank <= p_limit or r.is_me
  order by r.rank, r.display_name
  limit p_limit + 1;
end;
$$;
revoke all on function public.get_leaderboard(text, integer) from public;
grant execute on function public.get_leaderboard(text, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- Account deletion (cascades through every user table + removes avatar objects)
-- -----------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, storage as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  delete from storage.objects where bucket_id in ('avatars', 'progress-photos') and (storage.foldername(name))[1] = uid::text;
  delete from auth.users where id = uid;
end;
$$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- -----------------------------------------------------------------------------
-- Storage: avatars bucket (public read so <img> works without signed URLs; owner-only write under {uid}/)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars_owner_insert" on storage.objects;
create policy "avatars_owner_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.can_access());
drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.can_access());
drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects for select to public
  using (bucket_id = 'avatars');

-- -----------------------------------------------------------------------------
-- Tighten schema defaults
-- -----------------------------------------------------------------------------
revoke create on schema public from public;
