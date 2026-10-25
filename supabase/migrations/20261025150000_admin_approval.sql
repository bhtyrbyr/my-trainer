-- =============================================================================
-- Admin approval of new registrations.
--   profiles.status: pending | approved | rejected
--   app_config.require_approval (default true): new profiles start as 'pending'
--   Admins review via admin_list_registrations() / admin_set_registration_status()
--   Pending/rejected users can read ONLY their own profile (to show the waiting screen); every
--   other table stays locked because can_access() now requires status = 'approved'.
-- =============================================================================

alter table public.profiles
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by uuid references auth.users(id) on delete set null;

create index if not exists profiles_status_idx on public.profiles (status, created_at);

-- Everyone who registered before this feature is approved.
update public.profiles set status = 'approved', status_changed_at = now() where status = 'pending';

insert into public.app_config (key, value) values ('require_approval', 'true'::jsonb)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- can_access(): approved and not blocked. (No profile yet -> true, so onboarding can create one.)
-- -----------------------------------------------------------------------------
create or replace function public.can_access()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and coalesce(
       (select p.status = 'approved' and not p.is_blocked from public.profiles p where p.user_id = auth.uid()),
       true)
$$;

create or replace function public.has_onboarded()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.onboarding_completed_at is not null
      and p.status = 'approved' and not p.is_blocked
  )
$$;

-- A pending/rejected/blocked user must still be able to read their OWN profile row.
drop policy if exists "profiles_public_read" on public.profiles;
create policy "profiles_public_read" on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.can_access());

-- -----------------------------------------------------------------------------
-- Column protection: status is set server-side on insert; only admins (via RPC) change it later.
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
    if (bootstrap <> '' and public.jwt_email() = lower(bootstrap)) or (bootstrap = '' and not admin_exists) then
      new.role := 'admin';
    else
      new.role := 'user';
    end if;
    -- Admins are always approved; others wait when approval is required.
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

-- -----------------------------------------------------------------------------
-- Admin RPCs (security definer; every call re-checks is_admin())
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_registrations(p_status text default 'pending', p_limit integer default 100)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_path text,
  email text,
  status text,
  created_at timestamptz,
  status_changed_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
    select p.user_id, p.username::text, p.display_name, p.avatar_path, u.email::text, p.status, p.created_at, p.status_changed_at
    from public.profiles p
    join auth.users u on u.id = p.user_id
    where (p_status = 'all' or p.status = p_status)
      and p.onboarding_completed_at is not null
    order by p.created_at desc
    limit p_limit;
end;
$$;

create or replace function public.admin_set_registration_status(p_user uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_status not in ('approved', 'rejected', 'pending') then raise exception 'BAD_STATUS'; end if;
  if p_user = auth.uid() then raise exception 'CANNOT_CHANGE_SELF'; end if;
  perform set_config('app.internal', 'on', true);
  update public.profiles
     set status = p_status, status_changed_at = now(), status_changed_by = auth.uid()
   where user_id = p_user;
  perform set_config('app.internal', 'off', true);
end;
$$;

create or replace function public.admin_pending_count()
returns integer language sql stable security definer set search_path = public as $$
  select case when public.is_admin()
    then (select count(*)::int from public.profiles where status = 'pending' and onboarding_completed_at is not null)
    else 0 end
$$;

revoke all on function public.admin_list_registrations(text, integer), public.admin_set_registration_status(uuid, text), public.admin_pending_count() from public;
grant execute on function public.admin_list_registrations(text, integer), public.admin_set_registration_status(uuid, text), public.admin_pending_count() to authenticated;

-- Leaderboard: only approved users
create or replace function public.get_leaderboard(p_period text default 'week', p_limit integer default 50)
returns table (
  rank bigint, user_id uuid, username text, display_name text, avatar_path text,
  points bigint, level integer, active_days bigint, is_me boolean
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
    where p.show_on_leaderboard and not p.is_blocked and p.status = 'approved' and p.onboarding_completed_at is not null
  )
  select * from ranked r where r.rank <= p_limit or r.is_me
  order by r.rank, r.display_name
  limit p_limit + 1;
end;
$$;
