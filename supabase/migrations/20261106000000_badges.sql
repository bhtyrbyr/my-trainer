-- Faz 4: badges (docs/faz4-spec.md section 1, PRD M12).
--
-- badges       catalog: code, display order, threshold. Names/descriptions live in i18n (badges.json).
-- user_badges  one row per earned badge. Milestones: never revoked when the source rows are deleted
--              later, and they give no points. Written only by check_badges() (security definer);
--              clients only read their own rows. Other users' badges: get_user_badges().
--
-- Trigger points (each passes only the badges its table can move, so a tick costs one small count):
--   workout_sessions  after insert/update of ended_at, when a session becomes finished -> first_workout, sets_100
--   profiles          after update of longest_streak, when it grows to >= 7       -> streak_7, streak_30
--                     (longest_streak is raised only by award_points/recompute_streak and never lowered,
--                      so "current streak reached N" == longest_streak >= N)
--   progress_photos   after insert                                                 -> photos_10
--   habit_logs        after insert/update of count                                 -> habit_30
--   todo_completions  after insert                                                 -> todo_50
-- Module triggers rather than award_points(): a finished session or a habit day counts even when it
-- earned no points (daily caps, backdating window, minimum sets).

create table if not exists public.badges (
  code text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  sort integer not null default 0,
  threshold integer not null check (threshold >= 1)
);
insert into public.badges (code, sort, threshold) values
  ('first_workout', 10, 1),
  ('streak_7',      20, 7),
  ('streak_30',     30, 30),
  ('sets_100',      40, 100),
  ('photos_10',     50, 10),
  ('habit_30',      60, 30),
  ('todo_50',       70, 50)
on conflict (code) do nothing;

alter table public.badges enable row level security;
drop policy if exists "badges_read" on public.badges;
create policy "badges_read" on public.badges for select to authenticated using (public.can_access());
-- no write policies: service_role only

create table if not exists public.user_badges (
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_code text not null references public.badges(code) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_code)
);
create index if not exists user_badges_user_earned_idx on public.user_badges (user_id, earned_at desc);

alter table public.user_badges enable row level security;
drop policy if exists "user_badges_owner_read" on public.user_badges;
create policy "user_badges_owner_read" on public.user_badges for select to authenticated
  using (user_id = auth.uid() and public.can_access());
-- no insert/update/delete policies: written only by check_badges()

-- ---------------------------------------------------------------------------------------------
-- Awarding (internal). p_codes limits the check to the badges a trigger can move (null = all).
-- Already earned badges are skipped before any count runs; insert ... on conflict do nothing keeps it
-- idempotent under concurrency. Returns the codes newly earned by this call.
create or replace function public.check_badges(p_user uuid, p_codes text[] default null)
returns text[] language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  b record;
  v_value bigint;
  v_new text[] := '{}';
begin
  if p_user is null then return v_new; end if;
  for b in
    select bd.code, bd.threshold from public.badges bd
    where (p_codes is null or bd.code = any (p_codes))
      and not exists (select 1 from public.user_badges ub where ub.user_id = p_user and ub.badge_code = bd.code)
    order by bd.sort
  loop
    v_value := case
      when b.code = 'first_workout' then
        (select count(*) from public.workout_sessions s where s.user_id = p_user and s.ended_at is not null)
      when b.code = 'sets_100' then
        -- total_sets is fixed at finish: working sets (no warm-ups) with at least one rep
        (select coalesce(sum(s.total_sets), 0) from public.workout_sessions s where s.user_id = p_user and s.ended_at is not null)
      when b.code in ('streak_7', 'streak_30') then
        (select greatest(p.longest_streak, p.current_streak) from public.profiles p where p.user_id = p_user)
      when b.code = 'photos_10' then
        (select count(*) from public.progress_photos ph where ph.user_id = p_user)
      when b.code = 'habit_30' then
        (select count(*) from public.habit_logs l join public.habits h on h.id = l.habit_id
          where l.user_id = p_user and l.count >= h.target_count)
      when b.code = 'todo_50' then
        (select count(*) from public.todo_completions c where c.user_id = p_user)
      else 0
    end;
    if coalesce(v_value, 0) >= b.threshold then
      insert into public.user_badges (user_id, badge_code) values (p_user, b.code)
      on conflict (user_id, badge_code) do nothing;
      if found then v_new := v_new || b.code; end if;
    end if;
  end loop;
  return v_new;
end;
$$;
revoke execute on function public.check_badges(uuid, text[]) from public, anon, authenticated;
grant execute on function public.check_badges(uuid, text[]) to service_role;

-- One trigger function for every source table: tg_argv holds the badge codes to check.
create or replace function public.badges_after_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.check_badges(new.user_id, tg_argv::text[]);
  return null;
end;
$$;
revoke execute on function public.badges_after_activity() from public, anon, authenticated;

drop trigger if exists workout_sessions_badges on public.workout_sessions;
create trigger workout_sessions_badges after insert or update of ended_at on public.workout_sessions
  for each row when (new.ended_at is not null)
  execute function public.badges_after_activity('first_workout', 'sets_100');

drop trigger if exists profiles_badges on public.profiles;
create trigger profiles_badges after update of longest_streak on public.profiles
  for each row when (new.longest_streak > old.longest_streak and new.longest_streak >= 7)
  execute function public.badges_after_activity('streak_7', 'streak_30');

drop trigger if exists progress_photos_badges on public.progress_photos;
create trigger progress_photos_badges after insert on public.progress_photos
  for each row execute function public.badges_after_activity('photos_10');

drop trigger if exists habit_logs_badges on public.habit_logs;
create trigger habit_logs_badges after insert or update of count on public.habit_logs
  for each row execute function public.badges_after_activity('habit_30');

drop trigger if exists todo_completions_badges on public.todo_completions;
create trigger todo_completions_badges after insert on public.todo_completions
  for each row execute function public.badges_after_activity('todo_50');

-- ---------------------------------------------------------------------------------------------
-- Public view: the badges of an approved, non-blocked, onboarded user who is on the leaderboard,
-- or the caller's own. Anyone else (hidden, pending, rejected, blocked, unknown): no rows.
create or replace function public.get_user_badges(p_user uuid)
returns table (badge_code text, earned_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_access() or p_user is null then return; end if;
  if p_user <> auth.uid() and not exists (
    select 1 from public.profiles p
    where p.user_id = p_user and p.show_on_leaderboard and not p.is_blocked
      and p.status = 'approved' and p.onboarding_completed_at is not null
  ) then
    return;
  end if;
  return query
    select ub.badge_code, ub.earned_at
    from public.user_badges ub join public.badges b on b.code = ub.badge_code
    where ub.user_id = p_user
    order by b.sort;
end;
$$;
revoke execute on function public.get_user_badges(uuid) from public, anon;
grant execute on function public.get_user_badges(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- One-time backfill: everything users already did before badges existed.
select public.check_badges(p.user_id) from public.profiles p;
