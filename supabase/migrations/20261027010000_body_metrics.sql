-- Faz 2, step 2: body metrics (M2). One row per user per local day: weight and/or circumferences.
--
-- Points (docs/PRD.md section 1.4, rules already seeded in point_rules):
--   weight_log       10, once per day      ref body_metrics/<id>:w
--   measurement_log  15, once per week     ref body_metrics/<id>:m
-- Awarded by trigger (never by the client); removing the value or deleting the row revokes them.
-- award_points ignores days more than 2 days back, so old history can be entered without points.
--
-- The workout energy estimate now uses the latest logged weight on or before the session day.

create table if not exists public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  measured_on date not null,
  weight_kg numeric(5,1) check (weight_kg is null or weight_kg between 20 and 400),
  waist_cm numeric(5,1) check (waist_cm is null or waist_cm between 20 and 300),
  chest_cm numeric(5,1) check (chest_cm is null or chest_cm between 20 and 300),
  arm_cm numeric(5,1) check (arm_cm is null or arm_cm between 10 and 150),
  hip_cm numeric(5,1) check (hip_cm is null or hip_cm between 20 and 300),
  thigh_cm numeric(5,1) check (thigh_cm is null or thigh_cm between 10 and 200),
  note text check (note is null or char_length(note) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, measured_on)
);
create index if not exists body_metrics_user_day_idx on public.body_metrics (user_id, measured_on desc);

alter table public.body_metrics enable row level security;
drop policy if exists "body_metrics_owner_all" on public.body_metrics;
create policy "body_metrics_owner_all" on public.body_metrics for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());

drop trigger if exists body_metrics_set_updated_at on public.body_metrics;
create trigger body_metrics_set_updated_at before update on public.body_metrics
  for each row execute function public.set_updated_at();

-- No future days; the owner and the day of a row never change after insert.
create or replace function public.body_metrics_guard()
returns trigger language plpgsql set search_path = public set timezone = 'Europe/Istanbul' as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.measured_on := old.measured_on;
  elsif new.measured_on > current_date then
    raise exception 'FUTURE_DATE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists body_metrics_guard on public.body_metrics;
create trigger body_metrics_guard before insert or update on public.body_metrics
  for each row execute function public.body_metrics_guard();

create or replace function public.body_metrics_points()
returns trigger language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_had_measure boolean;
  v_has_measure boolean;
begin
  if tg_op = 'DELETE' then
    perform public.revoke_points(old.user_id, 'body_metrics', old.id::text || ':w');
    perform public.revoke_points(old.user_id, 'body_metrics', old.id::text || ':m');
    return old;
  end if;

  if new.weight_kg is not null then
    perform public.award_points(new.user_id, 'weight_log', new.measured_on, 'body_metrics', new.id::text || ':w');
  elsif tg_op = 'UPDATE' and old.weight_kg is not null then
    perform public.revoke_points(new.user_id, 'body_metrics', new.id::text || ':w');
  end if;

  v_has_measure := coalesce(new.waist_cm, new.chest_cm, new.arm_cm, new.hip_cm, new.thigh_cm) is not null;
  v_had_measure := tg_op = 'UPDATE' and coalesce(old.waist_cm, old.chest_cm, old.arm_cm, old.hip_cm, old.thigh_cm) is not null;
  if v_has_measure then
    perform public.award_points(new.user_id, 'measurement_log', new.measured_on, 'body_metrics', new.id::text || ':m');
  elsif v_had_measure then
    perform public.revoke_points(new.user_id, 'body_metrics', new.id::text || ':m');
  end if;
  return new;
end;
$$;
drop trigger if exists body_metrics_points on public.body_metrics;
create trigger body_metrics_points after insert or update or delete on public.body_metrics
  for each row execute function public.body_metrics_points();

-- Optional goal weight (private), drawn as a reference line on the weight chart.
alter table public.profile_private
  add column if not exists target_weight_kg numeric(5,1)
  check (target_weight_kg is null or target_weight_kg between 20 and 400);

-- ---------------------------------------------------------------------------------------------
-- Body weight for a given day: latest logged weight on or before it, else the onboarding start
-- weight, else the earliest weight logged after it. Internal (energy estimate).
create or replace function public.body_weight_for(p_user uuid, p_on date)
returns numeric language sql stable set search_path = public as $$
  select coalesce(
    (select bm.weight_kg from public.body_metrics bm
      where bm.user_id = p_user and bm.weight_kg is not null and bm.measured_on <= p_on
      order by bm.measured_on desc limit 1),
    (select pp.start_weight_kg from public.profile_private pp where pp.user_id = p_user),
    (select bm.weight_kg from public.body_metrics bm
      where bm.user_id = p_user and bm.weight_kg is not null
      order by bm.measured_on asc limit 1)
  )
$$;

create or replace function public.estimate_session_kcal(p_session uuid, p_user uuid, p_kind text, p_duration integer)
returns table (kcal integer, weight_kg numeric)
language plpgsql stable set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_day date;
  v_weight numeric;
  v_known boolean;
  v_sex text;
  v_birth smallint;
  v_age integer;
  v_sets integer;
  v_rpe numeric;
  v_total numeric := 0;
  v_rate numeric;
  v_speed numeric;
  rec record;
begin
  select coalesce(ws.started_at::date, current_date) into v_day from public.workout_sessions ws where ws.id = p_session;
  v_weight := public.body_weight_for(p_user, coalesce(v_day, current_date));
  select pp.sex, pp.birth_year into v_sex, v_birth from public.profile_private pp where pp.user_id = p_user;
  v_known := v_weight is not null;
  v_weight := coalesce(v_weight, 70);

  if p_kind = 'strength' then
    select count(*)::int, avg(ss.rpe) into v_sets, v_rpe
    from public.session_sets ss
    where ss.session_id = p_session and not ss.is_warmup and coalesce(ss.reps, 0) >= 1;
    if coalesce(v_sets, 0) = 0 or coalesce(p_duration, 0) < 60 then
      return query select null::integer, null::numeric;
      return;
    end if;
    v_total := public.strength_met(v_rpe) * v_weight * least(p_duration, 10800) / 3600.0;
  else
    v_age := case when v_birth is null then null else extract(year from current_date)::int - v_birth end;
    for rec in
      select ce.activity, ce.duration_sec, ce.distance_m, ce.avg_hr
      from public.cardio_entries ce where ce.session_id = p_session
    loop
      v_rate := null;  -- kcal per minute
      if v_known and rec.avg_hr between 90 and 200 and v_sex in ('male', 'female') and v_age between 15 and 90 then
        v_rate := case v_sex
          when 'male' then (-55.0969 + 0.6309 * rec.avg_hr + 0.1988 * v_weight + 0.2017 * v_age) / 4.184
          else (-20.4022 + 0.4472 * rec.avg_hr - 0.1263 * v_weight + 0.074 * v_age) / 4.184
        end;
      end if;
      if v_rate is null or v_rate <= 0 then
        v_speed := case when coalesce(rec.distance_m, 0) > 0 then rec.distance_m / 1000.0 / (rec.duration_sec / 3600.0) end;
        v_rate := public.cardio_met(rec.activity, v_speed) * v_weight / 60.0;
      end if;
      v_total := v_total + v_rate * least(rec.duration_sec, 14400) / 60.0;
    end loop;
    if v_total <= 0 then
      return query select null::integer, null::numeric;
      return;
    end if;
  end if;

  return query select round(v_total)::integer, case when v_known then v_weight end;
end;
$$;

revoke execute on function public.body_metrics_guard(), public.body_metrics_points(),
  public.body_weight_for(uuid, date), public.estimate_session_kcal(uuid, uuid, text, integer)
  from public, anon, authenticated;
