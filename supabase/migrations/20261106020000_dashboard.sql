-- Faz 4: dashboard week summary (docs/faz4-spec.md sections 1 and 3, PRD M7).
--
-- Both functions run with the CALLER's rights (security invoker): every table read is limited by RLS,
-- so health parts (sleep, weight, water) are already invisible without health consent; they are
-- returned as null then rather than 0. Weeks are Istanbul calendar weeks starting on Monday
-- (user_settings.week_starts_on is not applied yet).

-- Due vs completed habit-days of the caller in [p_from, p_to], future days excluded (range capped at
-- 366 days). A day is due when the rule matches, the habit had started and was not archived yet; it is
-- completed when the day's count reached the habit's target. weekly_count habits are due n times per
-- ISO week (fewer when the week has fewer eligible days so far), and count at most n completions.
create or replace function public.habit_due_done(p_from date, p_to date)
returns table (due integer, done integer)
language sql stable set search_path = public set timezone = 'Europe/Istanbul' as $$
  with days as (
    select g::date as d
    from generate_series(p_from::timestamp, least(p_to, current_date, p_from + 365)::timestamp, interval '1 day') g
  ),
  hd as (
    select h.id, h.rule ->> 'type' as kind, (h.rule ->> 'n')::int as n, date_trunc('week', d.d)::date as wk,
           coalesce(l.count, 0) >= h.target_count as is_done
    from public.habits h
    join days d on d.d >= h.starts_on
               and (h.archived_at is null or d.d < h.archived_at::date)
               and public.recurrence_matches(h.rule, h.starts_on, d.d)
    left join public.habit_logs l on l.habit_id = h.id and l.day = d.d
    where h.user_id = auth.uid()
  ),
  per as (
    select case when kind = 'weekly_count' then least(n, count(*)) else count(*) end as due,
           case when kind = 'weekly_count' then least(n, count(*) filter (where is_done))
                else count(*) filter (where is_done) end as done
    from hd
    group by id, kind, n, wk
  )
  select coalesce(sum(per.due), 0)::int, coalesce(sum(per.done), 0)::int from per
$$;

-- The caller's week at a glance. p_week_start may be any day of the wanted week (null = this week);
-- it is normalised to that week's Monday, echoed back as week_start.
create or replace function public.get_week_summary(p_week_start date default null)
returns jsonb language plpgsql stable set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_uid uuid := auth.uid();
  v_start date := date_trunc('week', coalesce(p_week_start, current_date))::date;
  v_end date;
  v_health boolean := coalesce(public.has_health_consent(), false);
  v_workouts integer;
  v_sets integer;
  v_volume numeric;
  v_cardio integer;
  v_due integer;
  v_done integer;
  v_todos integer;
  v_sleep integer;
  v_last numeric;
  v_before numeric;
  v_water integer;
  v_goal integer;
begin
  if v_uid is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  v_end := v_start + 7;

  -- finished sessions dated by their local start day (as the points engine does)
  select count(*)::int, coalesce(sum(s.total_sets), 0)::int, round(coalesce(sum(s.total_volume_kg), 0), 1),
         round(coalesce(sum(s.duration_sec) filter (where s.kind = 'cardio'), 0) / 60.0)::int
    into v_workouts, v_sets, v_volume, v_cardio
  from public.workout_sessions s
  where s.user_id = v_uid and s.ended_at is not null
    and s.started_at >= v_start::timestamptz and s.started_at < v_end::timestamptz;

  select hd.due, hd.done into v_due, v_done from public.habit_due_done(v_start, v_end - 1) hd;

  select count(*)::int into v_todos
  from public.todo_completions c
  where c.user_id = v_uid and c.completed_on >= v_start and c.completed_on < v_end;

  if v_health then
    select round(avg(se.duration_min))::int into v_sleep
    from public.sleep_entries se
    where se.user_id = v_uid and se.sleep_on >= v_start and se.sleep_on < v_end;

    select bm.weight_kg into v_last from public.body_metrics bm
    where bm.user_id = v_uid and bm.weight_kg is not null and bm.measured_on >= v_start and bm.measured_on < v_end
    order by bm.measured_on desc limit 1;
    select bm.weight_kg into v_before from public.body_metrics bm
    where bm.user_id = v_uid and bm.weight_kg is not null and bm.measured_on < v_start
    order by bm.measured_on desc limit 1;

    v_goal := coalesce((select us.daily_water_ml from public.user_settings us where us.user_id = v_uid), 2500);
    select count(*)::int into v_water
    from (
      select w.drunk_on from public.water_entries w
      where w.user_id = v_uid and w.drunk_on >= v_start and w.drunk_on < v_end
      group by w.drunk_on
      having sum(w.amount_ml) >= v_goal
    ) days;
  end if;

  return jsonb_build_object(
    'week_start', v_start,
    'workouts', v_workouts,
    'sets', v_sets,
    'volume_kg', v_volume,
    'cardio_minutes', v_cardio,
    'habit_rate', case when coalesce(v_due, 0) = 0 then null else round(v_done::numeric / v_due, 3) end,
    'todos_done', v_todos,
    'avg_sleep_minutes', v_sleep,
    'weight_change_kg', v_last - v_before,
    'water_goal_days', case when v_health then v_water end
  );
end;
$$;

-- Invoker functions over RLS'd tables: safe for signed-in users, never for anon.
revoke execute on function public.habit_due_done(date, date), public.get_week_summary(date) from public, anon;
grant execute on function public.habit_due_done(date, date), public.get_week_summary(date) to authenticated;
