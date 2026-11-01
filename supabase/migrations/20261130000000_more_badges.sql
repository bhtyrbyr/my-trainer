-- More badges (2026-11-01): 7 -> 32, grouped in families by metric. Same rules as before: awarded only by
-- the database (check_badges), never revoked, no points. One metric function is the single source for
-- both awarding and the caller's own progress (my_badge_progress), so the shelf and the award agree.
alter table public.badges add column if not exists metric text;

insert into public.badges (code, sort, threshold, metric) values
  ('first_workout',   100, 1,       'workouts'),
  ('workouts_10',     101, 10,      'workouts'),
  ('workouts_50',     102, 50,      'workouts'),
  ('workouts_100',    103, 100,     'workouts'),
  ('workouts_250',    104, 250,     'workouts'),
  ('streak_7',        200, 7,       'streak'),
  ('streak_30',       201, 30,      'streak'),
  ('streak_100',      202, 100,     'streak'),
  ('streak_365',      203, 365,     'streak'),
  ('sets_100',        300, 100,     'sets'),
  ('sets_500',        301, 500,     'sets'),
  ('sets_1000',       302, 1000,    'sets'),
  ('sets_5000',       303, 5000,    'sets'),
  ('volume_10t',      400, 10000,   'volume_kg'),
  ('volume_100t',     401, 100000,  'volume_kg'),
  ('volume_1000t',    402, 1000000, 'volume_kg'),
  ('pr_10',           500, 10,      'prs'),
  ('pr_50',           501, 50,      'prs'),
  ('cardio_600',      600, 600,     'cardio_minutes'),
  ('cardio_3000',     601, 3000,    'cardio_minutes'),
  ('early_bird_5',    700, 5,       'early_workouts'),
  ('weekend_10',      701, 10,      'weekend_workouts'),
  ('habit_30',        800, 30,      'habit_days'),
  ('habit_100',       801, 100,     'habit_days'),
  ('habit_365',       802, 365,     'habit_days'),
  ('todo_50',         900, 50,      'todos'),
  ('todo_200',        901, 200,     'todos'),
  ('water_30',       1000, 30,      'water_goal_days'),
  ('sleep_30',       1001, 30,      'sleep_logs'),
  ('weigh_30',       1002, 30,      'weigh_ins'),
  ('photos_10',      1100, 10,      'photos'),
  ('photos_25',      1101, 25,      'photos')
on conflict (code) do update set sort = excluded.sort, threshold = excluded.threshold, metric = excluded.metric;

alter table public.badges alter column metric set not null;

-- Internal: one metric of one user. Health metrics (weigh-ins, sleep, water, photos) read the user's own
-- rows; RLS is bypassed here (security definer), which is fine because only counts leave and only to
-- check_badges / the owner's own progress.
create or replace function public.badge_metric_value(p_user uuid, p_metric text)
returns bigint language sql stable security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
  select case p_metric
    when 'workouts' then (select count(*) from public.workout_sessions s where s.user_id = p_user and s.ended_at is not null)
    when 'sets' then (select coalesce(sum(s.total_sets), 0) from public.workout_sessions s where s.user_id = p_user and s.ended_at is not null)
    when 'volume_kg' then (select coalesce(sum(s.total_volume_kg), 0)::bigint from public.workout_sessions s where s.user_id = p_user and s.ended_at is not null)
    when 'cardio_minutes' then (select coalesce(sum(s.duration_sec), 0) / 60 from public.workout_sessions s
                                 where s.user_id = p_user and s.ended_at is not null and s.kind = 'cardio')
    when 'early_workouts' then (select count(*) from public.workout_sessions s
                                 where s.user_id = p_user and s.ended_at is not null and extract(hour from s.started_at) < 7)
    when 'weekend_workouts' then (select count(*) from public.workout_sessions s
                                   where s.user_id = p_user and s.ended_at is not null and extract(isodow from s.started_at) in (6, 7))
    when 'streak' then (select greatest(p.longest_streak, p.current_streak) from public.profiles p where p.user_id = p_user)
    when 'prs' then (select count(*) from public.point_events e where e.user_id = p_user and e.kind = 'personal_record')
    when 'water_goal_days' then (select count(*) from public.point_events e where e.user_id = p_user and e.kind = 'water_goal')
    when 'photos' then (select count(*) from public.progress_photos ph where ph.user_id = p_user)
    when 'habit_days' then (select count(*) from public.habit_logs l join public.habits h on h.id = l.habit_id
                             where l.user_id = p_user and l.count >= h.target_count)
    when 'todos' then (select count(*) from public.todo_completions c where c.user_id = p_user)
    when 'sleep_logs' then (select count(*) from public.sleep_entries e where e.user_id = p_user)
    when 'weigh_ins' then (select count(*) from public.body_metrics m where m.user_id = p_user and m.weight_kg is not null)
    else 0
  end
$$;
revoke execute on function public.badge_metric_value(uuid, text) from public, anon, authenticated;

-- p_codes: badge codes a trigger can move (null = all). Each metric is computed at most once per call.
create or replace function public.check_badges(p_user uuid, p_codes text[] default null)
returns text[] language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  b record;
  v_values jsonb := '{}';
  v_value bigint;
  v_new text[] := '{}';
begin
  if p_user is null then return v_new; end if;
  for b in
    select bd.code, bd.threshold, bd.metric from public.badges bd
    where (p_codes is null or bd.code = any (p_codes))
      and not exists (select 1 from public.user_badges ub where ub.user_id = p_user and ub.badge_code = bd.code)
    order by bd.sort
  loop
    if not v_values ? b.metric then
      v_values := v_values || jsonb_build_object(b.metric, public.badge_metric_value(p_user, b.metric));
    end if;
    v_value := (v_values ->> b.metric)::bigint;
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

-- Owner's progress for the shelf: { metric: value } for every metric in the catalog.
create or replace function public.my_badge_progress()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.can_access() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return (select coalesce(jsonb_object_agg(m.metric, public.badge_metric_value(v_uid, m.metric)), '{}'::jsonb)
          from (select distinct metric from public.badges) m);
end;
$$;
revoke execute on function public.my_badge_progress() from public, anon;
grant execute on function public.my_badge_progress() to authenticated;

-- Triggers: the codes each source can move (badges_after_activity passes tg_argv to check_badges).
drop trigger if exists workout_sessions_badges on public.workout_sessions;
create trigger workout_sessions_badges after insert or update of ended_at on public.workout_sessions
  for each row when (new.ended_at is not null)
  execute function public.badges_after_activity('first_workout', 'workouts_10', 'workouts_50', 'workouts_100', 'workouts_250',
    'sets_100', 'sets_500', 'sets_1000', 'sets_5000', 'volume_10t', 'volume_100t', 'volume_1000t',
    'cardio_600', 'cardio_3000', 'early_bird_5', 'weekend_10');

drop trigger if exists profiles_badges on public.profiles;
create trigger profiles_badges after update of longest_streak on public.profiles
  for each row when (new.longest_streak > old.longest_streak and new.longest_streak >= 7)
  execute function public.badges_after_activity('streak_7', 'streak_30', 'streak_100', 'streak_365');

drop trigger if exists progress_photos_badges on public.progress_photos;
create trigger progress_photos_badges after insert on public.progress_photos
  for each row execute function public.badges_after_activity('photos_10', 'photos_25');

drop trigger if exists habit_logs_badges on public.habit_logs;
create trigger habit_logs_badges after insert or update of count on public.habit_logs
  for each row execute function public.badges_after_activity('habit_30', 'habit_100', 'habit_365');

drop trigger if exists todo_completions_badges on public.todo_completions;
create trigger todo_completions_badges after insert on public.todo_completions
  for each row execute function public.badges_after_activity('todo_50', 'todo_200');

drop trigger if exists sleep_entries_badges on public.sleep_entries;
create trigger sleep_entries_badges after insert on public.sleep_entries
  for each row execute function public.badges_after_activity('sleep_30');

drop trigger if exists body_metrics_badges on public.body_metrics;
create trigger body_metrics_badges after insert or update of weight_kg on public.body_metrics
  for each row when (new.weight_kg is not null)
  execute function public.badges_after_activity('weigh_30');

drop trigger if exists point_events_badges on public.point_events;
create trigger point_events_badges after insert on public.point_events
  for each row when (new.kind in ('personal_record', 'water_goal'))
  execute function public.badges_after_activity('pr_10', 'pr_50', 'water_30');

-- Existing users: award what they already qualify for.
select public.check_badges(p.user_id) from public.profiles p where p.onboarding_completed_at is not null;
