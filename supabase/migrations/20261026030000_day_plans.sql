-- Day-based workout plans + richer progress data for the exercise page.
--  * workout_templates.weekdays: ISO weekdays (1 = Monday ... 7 = Sunday) this template is planned for.
--  * todays_templates(): the caller's templates planned for a given ISO weekday (defaults to today).
--  * exercise_progress(): adds average / max working weight and best reps per session for the chart.

alter table public.workout_templates
  add column if not exists weekdays smallint[] not null default '{}'
    check (weekdays <@ array[1,2,3,4,5,6,7]::smallint[]);

create index if not exists workout_templates_weekdays_idx on public.workout_templates using gin (weekdays);

create or replace function public.todays_templates(p_isodow integer default null)
returns setof public.workout_templates
language sql stable security invoker set search_path = public as $$
  select t.*
  from public.workout_templates t
  where t.user_id = auth.uid()
    and not t.archived
    and coalesce(p_isodow, extract(isodow from current_date)::int)::smallint = any (t.weekdays)
  order by t.sort_order, t.created_at
$$;
revoke all on function public.todays_templates(integer) from public, anon;
grant execute on function public.todays_templates(integer) to authenticated;

drop function if exists public.exercise_progress(uuid);
create function public.exercise_progress(p_exercise uuid)
returns table (
  session_id uuid,
  started_at timestamptz,
  best_e1rm numeric,
  best_weight_kg numeric,
  avg_weight_kg numeric,
  best_reps integer,
  total_volume_kg numeric,
  total_sets integer
)
language sql stable security invoker set search_path = public as $$
  select
    s.id,
    s.started_at,
    max(public.e1rm(ss.weight_kg, ss.reps)),
    max(ss.weight_kg),
    round(avg(ss.weight_kg), 2),
    max(ss.reps),
    coalesce(sum(coalesce(ss.weight_kg, 0) * ss.reps), 0),
    count(ss.id)::int
  from public.workout_sessions s
  join public.session_exercises se on se.session_id = s.id
  join public.session_sets ss on ss.session_exercise_id = se.id
  where s.user_id = auth.uid()
    and s.ended_at is not null
    and se.exercise_id = p_exercise
    and not ss.is_warmup
    and ss.reps >= 1
  group by s.id, s.started_at
  order by s.started_at
$$;
revoke all on function public.exercise_progress(uuid) from public, anon;
grant execute on function public.exercise_progress(uuid) to authenticated;
