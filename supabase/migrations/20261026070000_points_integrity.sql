-- Points integrity (Faz 1 QA review). Fixes:
--  H1  award_points caps could be beaten by parallel finish calls -> per-user row lock serialises awards.
--  H2  a finished session could be finished again (re-dating old PRs to today) -> ALREADY_FINISHED.
--  M3  streak rollback ignored bonus rows -> bonuses excluded from streak math and revoked with their day.
--  M4  near-zero-effort scoring -> minimums: strength >= 3 working sets, cardio >= 10 min;
--      first log of an exercise is a silent baseline (no PR points); custom exercises never earn PR points;
--      personal_record daily cap 40.
--  L6  clients could rewrite kind/ended_at/totals/started_at of a session -> column protection trigger.
--      Clients may no longer delete personal_records directly (cascade from their set/session only).
-- Session points are dated by the session's local START day, clamped to [today-2, today].

-- ---------------------------------------------------------------------------------------------
-- M4: rule change
update public.point_rules set daily_cap = 40, description = 'New PR on a catalog exercise (not the first log), max 40/day'
where kind = 'personal_record';

-- ---------------------------------------------------------------------------------------------
-- H1: award_points serialised per user (FOR UPDATE on the profile row before reading caps)
create or replace function public.award_points(
  p_user uuid,
  p_kind text,
  p_occurred_on date,
  p_ref_table text,
  p_ref_id text,
  p_points_override integer default null
) returns integer
language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
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
  -- Lock first: concurrent awards for the same user wait here, so the cap sums below are always current.
  select * into prof from public.profiles
   where user_id = p_user and onboarding_completed_at is not null and not is_blocked
   for update;
  if not found then return 0; end if;
  if p_occurred_on < current_date - 2 or p_occurred_on > current_date then return 0; end if;

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

  insert into public.point_events (user_id, kind, points, occurred_on, ref_table, ref_id)
  values (p_user, p_kind, pts, p_occurred_on, p_ref_table, p_ref_id)
  on conflict (user_id, kind, ref_table, ref_id) do nothing;
  get diagnostics inserted = row_count;
  if not inserted then return 0; end if;

  perform set_config('app.internal', 'on', true);

  if pts > 0 and p_kind not like 'streak\_%' then
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

  if pts > 0 and p_kind not like 'streak\_%' and p_occurred_on = prof.last_active_on then
    if prof.current_streak > 0 and prof.current_streak % 30 = 0 then
      perform public.award_points(p_user, 'streak_30', p_occurred_on, 'streak', p_occurred_on::text);
    elsif prof.current_streak > 0 and prof.current_streak % 7 = 0 then
      perform public.award_points(p_user, 'streak_7', p_occurred_on, 'streak', p_occurred_on::text);
    end if;
  end if;

  perform set_config('app.internal', 'off', true);
  return pts;
end;
$$;
revoke execute on function public.award_points(uuid, text, date, text, text, integer) from public, anon, authenticated;
grant execute on function public.award_points(uuid, text, date, text, text, integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- M3: streak math ignores bonus rows; revoking a day's last base activity also revokes that day's bonus
create or replace function public.recompute_streak(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_last date;
  v_streak integer;
begin
  select max(occurred_on) into v_last
  from public.point_events
  where user_id = p_user and points > 0 and kind not like 'streak\_%';

  if v_last is null then
    v_streak := 0;
  else
    with days as (
      select distinct occurred_on as d from public.point_events
      where user_id = p_user and points > 0 and kind not like 'streak\_%'
    ),
    grouped as (select d, d - (row_number() over (order by d))::int as grp from days)
    select count(*) into v_streak from grouped where grp = (select grp from grouped where d = v_last);
  end if;

  perform set_config('app.internal', 'on', true);
  update public.profiles
     set current_streak = v_streak,
         last_active_on = v_last,
         longest_streak = greatest(longest_streak, v_streak)
   where user_id = p_user;
  perform set_config('app.internal', 'off', true);
end;
$$;
revoke execute on function public.recompute_streak(uuid) from public, anon, authenticated;
grant execute on function public.recompute_streak(uuid) to service_role;

create or replace function public.revoke_points(p_user uuid, p_ref_table text, p_ref_id text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  removed integer;
  rows_deleted integer;
  bonus_removed integer;
begin
  with d as (
    delete from public.point_events
    where user_id = p_user and ref_table = p_ref_table and ref_id = p_ref_id
    returning points
  ) select coalesce(sum(points), 0), count(*) into removed, rows_deleted from d;

  if rows_deleted > 0 then
    -- streak bonus rows whose day no longer has any base scoring activity
    with b as (
      delete from public.point_events e
      where e.user_id = p_user and e.kind like 'streak\_%'
        and not exists (
          select 1 from public.point_events x
          where x.user_id = p_user and x.occurred_on = e.occurred_on and x.points > 0 and x.kind not like 'streak\_%'
        )
      returning points
    ) select coalesce(sum(points), 0) into bonus_removed from b;

    perform set_config('app.internal', 'on', true);
    update public.profiles set total_points = greatest(total_points - removed - bonus_removed, 0) where user_id = p_user;
    perform set_config('app.internal', 'off', true);
    perform public.recompute_streak(p_user);
    removed := removed + bonus_removed;
  end if;
  return removed;
end;
$$;
revoke execute on function public.revoke_points(uuid, text, text) from public, anon, authenticated;
grant execute on function public.revoke_points(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- L6: clients cannot rewrite a session's server-owned columns; PRs are not client-deletable
create or replace function public.protect_workout_session_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.is_internal() then return new; end if;
  if tg_op = 'INSERT' then
    new.ended_at := null;
    new.duration_sec := null;
    new.total_sets := 0;
    new.total_volume_kg := 0;
    if new.started_at is null or new.started_at > now() then new.started_at := now(); end if;
    return new;
  end if;
  new.user_id := old.user_id;
  new.kind := old.kind;
  new.started_at := old.started_at;
  new.ended_at := old.ended_at;
  new.duration_sec := old.duration_sec;
  new.total_sets := old.total_sets;
  new.total_volume_kg := old.total_volume_kg;
  return new;
end;
$$;
revoke execute on function public.protect_workout_session_columns() from public, anon, authenticated;
drop trigger if exists workout_sessions_protect_columns on public.workout_sessions;
create trigger workout_sessions_protect_columns before insert or update on public.workout_sessions
  for each row execute function public.protect_workout_session_columns();

drop policy if exists "personal_records_owner_delete" on public.personal_records;

-- ---------------------------------------------------------------------------------------------
-- H2 + M4: finish_workout_session
create or replace function public.finish_workout_session(p_session uuid)
returns jsonb language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  s public.workout_sessions%rowtype;
  v_now timestamptz := now();
  v_date date;
  v_duration integer;
  v_cardio_duration integer;
  v_total_sets integer := 0;
  v_total_volume numeric(10,1) := 0;
  v_points integer := 0;
  v_pr_points integer;
  v_prev_best numeric;
  v_is_custom boolean;
  v_new_prs jsonb := '[]'::jsonb;
  rec record;
begin
  if not exists (select 1 from public.workout_sessions where id = p_session and user_id = auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not public.can_access() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into s from public.workout_sessions where id = p_session for update;
  if s.ended_at is not null then
    raise exception 'ALREADY_FINISHED' using errcode = 'P0001';
  end if;

  select coalesce(count(*), 0)::int, coalesce(sum(coalesce(ss.weight_kg, 0) * coalesce(ss.reps, 0)), 0)
    into v_total_sets, v_total_volume
  from public.session_sets ss
  where ss.session_id = p_session and not ss.is_warmup and coalesce(ss.reps, 0) >= 1;

  v_duration := greatest(0, floor(extract(epoch from (v_now - s.started_at)))::int);
  if s.kind = 'cardio' then
    select sum(ce.duration_sec)::int into v_cardio_duration from public.cardio_entries ce where ce.session_id = p_session;
    if v_cardio_duration is not null and v_cardio_duration > 0 then
      v_duration := v_cardio_duration;
    end if;
  end if;

  perform set_config('app.internal', 'on', true);
  update public.workout_sessions
     set ended_at = v_now,
         duration_sec = v_duration,
         total_sets = v_total_sets,
         total_volume_kg = v_total_volume
   where id = p_session;
  perform set_config('app.internal', 'off', true);

  -- local start day (function runs in Europe/Istanbul), clamped to the backdating window
  v_date := greatest(least(s.started_at::date, current_date), current_date - 2);

  if s.kind = 'strength' and v_total_sets >= 3 then
    v_points := v_points + public.award_points(s.user_id, 'workout_strength', v_date, 'workout_sessions', s.id::text, 50 + 2 * v_total_sets);
  elsif s.kind = 'cardio' and v_duration >= 600 then
    v_points := v_points + public.award_points(s.user_id, 'workout_cardio', v_date, 'workout_sessions', s.id::text, 30 + floor(v_duration / 300.0)::int);
  end if;

  for rec in
    select *
    from (
      select se.exercise_id, ss.id as set_id, ss.weight_kg, ss.reps,
             public.e1rm(ss.weight_kg, ss.reps) as e1rm,
             row_number() over (partition by se.exercise_id
                                order by public.e1rm(ss.weight_kg, ss.reps) desc, ss.weight_kg desc, ss.completed_at asc) as rn
      from public.session_sets ss
      join public.session_exercises se on se.id = ss.session_exercise_id
      where ss.session_id = p_session
        and not ss.is_warmup
        and public.e1rm(ss.weight_kg, ss.reps) is not null
    ) ranked
    where rn = 1
  loop
    select max(pr.e1rm) into v_prev_best
    from public.personal_records pr
    where pr.user_id = s.user_id and pr.exercise_id = rec.exercise_id;

    if v_prev_best is null or rec.e1rm > v_prev_best then
      insert into public.personal_records (user_id, exercise_id, session_set_id, weight_kg, reps, e1rm, achieved_on)
      values (s.user_id, rec.exercise_id, rec.set_id, rec.weight_kg, rec.reps, rec.e1rm, v_date)
      on conflict (user_id, exercise_id, achieved_on) do update
        set session_set_id = excluded.session_set_id,
            weight_kg = excluded.weight_kg,
            reps = excluded.reps,
            e1rm = excluded.e1rm;

      -- The first log is a baseline, not a record: no points, not announced.
      if v_prev_best is not null then
        select e.is_custom into v_is_custom from public.exercises e where e.id = rec.exercise_id;
        if not coalesce(v_is_custom, false) then
          v_pr_points := public.award_points(s.user_id, 'personal_record', v_date, 'personal_records', rec.exercise_id::text || ':' || v_date::text);
          v_points := v_points + coalesce(v_pr_points, 0);
        end if;
        v_new_prs := v_new_prs || jsonb_build_object(
          'exercise_id', rec.exercise_id,
          'e1rm', rec.e1rm,
          'weight_kg', rec.weight_kg,
          'reps', rec.reps
        );
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'duration_sec', v_duration,
    'total_sets', v_total_sets,
    'total_volume_kg', v_total_volume,
    'points_awarded', v_points,
    'new_prs', v_new_prs
  );
end;
$$;
revoke execute on function public.finish_workout_session(uuid) from public, anon;
grant execute on function public.finish_workout_session(uuid) to authenticated;
