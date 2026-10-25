-- 1) Local calendar day. The database runs in UTC, so between 00:00 and 03:00 Turkish time "today"
--    was still yesterday: points, PR dates, streaks, the leaderboard week and "today's plan" were off
--    by a day. Every function that derives a calendar date now runs with the app's timezone.
--    (Single timezone for now: all users are in Turkey. Per-user timezones can replace this later.)
insert into public.app_config (key, value) values ('timezone', '"Europe/Istanbul"'::jsonb)
on conflict (key) do nothing;

alter function public.award_points(uuid, text, date, text, text, integer) set timezone = 'Europe/Istanbul';
alter function public.finish_workout_session(uuid) set timezone = 'Europe/Istanbul';
alter function public.get_leaderboard(text, integer) set timezone = 'Europe/Istanbul';
alter function public.todays_templates(integer) set timezone = 'Europe/Istanbul';
-- effective_streak reads current_date, so it cannot be IMMUTABLE.
alter function public.effective_streak(integer, date) stable;
alter function public.effective_streak(integer, date) set timezone = 'Europe/Istanbul';

-- 2) last_sets_for_exercise: only sessions that actually logged sets for this exercise count as
--    "last time". Before, a finished session that merely listed the exercise (skipped, 0 sets) hid
--    the real previous numbers.
create or replace function public.last_sets_for_exercise(p_exercise uuid, p_limit integer default 1)
returns table (
  session_id uuid,
  started_at timestamptz,
  session_exercise_id uuid,
  set_id uuid,
  set_no integer,
  weight_kg numeric,
  reps integer,
  rpe numeric,
  is_warmup boolean,
  completed_at timestamptz
)
language sql stable set search_path = public as $$
  with picked as (
    select ws.id as session_id, ws.started_at
    from public.workout_sessions ws
    where ws.user_id = auth.uid()
      and ws.ended_at is not null
      and exists (
        select 1
        from public.session_exercises se
        join public.session_sets ss on ss.session_exercise_id = se.id
        where se.session_id = ws.id and se.exercise_id = p_exercise
      )
    order by ws.started_at desc
    limit greatest(coalesce(p_limit, 1), 1)
  )
  select p.session_id, p.started_at, se.id, ss.id, ss.set_no, ss.weight_kg, ss.reps, ss.rpe, ss.is_warmup, ss.completed_at
  from picked p
  join public.session_exercises se on se.session_id = p.session_id and se.exercise_id = p_exercise
  join public.session_sets ss on ss.session_exercise_id = se.id
  order by p.started_at desc, se.position, ss.set_no
$$;
