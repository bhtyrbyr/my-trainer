-- Faz 2, step 1: estimated energy burned per workout session.
--
-- The estimate is computed by the database when a session is finished (finish_workout_session sets
-- app.internal) and stored on the session, so history stays stable when body weight changes later and
-- clients cannot edit it. It never earns points and is never added to the eaten-calorie budget: the
-- daily view shows "eaten" and "burned" side by side (product decision 2026-10-25).
--
-- Method (gross energy, kcal = MET x kg x hours), MET values from the 2024 Adult Compendium of
-- Physical Activities:
--   strength: 3.5 (light, avg RPE < 7), 5.0 (moderate or RPE not logged), 6.0 (vigorous, avg RPE >= 8.5);
--             wall-clock session time including rests (the compendium values include rests), capped at 3 h,
--             only when at least one working set was logged.
--   cardio:   activity + speed band when distance is known, activity default otherwise, capped at 4 h.
--             With an average heart rate (90-200 bpm), a known weight, sex (male/female) and birth year,
--             the Keytel et al. (2005) heart-rate equation is used instead.
-- Body weight: profile_private.start_weight_kg for now (Faz 2 body metrics will prefer the latest
-- logged weight); unknown weight falls back to 70 kg and kcal_weight_kg stays null so the UI can say
-- the estimate improves once the weight is entered.

alter table public.workout_sessions
  add column if not exists kcal_estimate integer check (kcal_estimate is null or kcal_estimate between 0 and 20000),
  add column if not exists kcal_weight_kg numeric(5,1);

comment on column public.workout_sessions.kcal_estimate is 'Estimated gross kcal burned (server-computed on finish; not points, not part of eaten calories).';
comment on column public.workout_sessions.kcal_weight_kg is 'Body weight used for kcal_estimate; null when the 70 kg default was assumed.';

-- ---------------------------------------------------------------------------------------------
-- MET helpers (pure)
create or replace function public.strength_met(p_avg_rpe numeric)
returns numeric language sql immutable set search_path = public as $$
  select case
    when p_avg_rpe is null then 5.0
    when p_avg_rpe < 7 then 3.5
    when p_avg_rpe < 8.5 then 5.0
    else 6.0
  end
$$;

create or replace function public.cardio_met(p_activity text, p_speed_kmh numeric)
returns numeric language sql immutable set search_path = public as $$
  select case p_activity
    when 'run' then case
      when p_speed_kmh is null or p_speed_kmh <= 0 or p_speed_kmh > 25 then 9.0
      when p_speed_kmh < 7.5 then 6.5
      when p_speed_kmh < 8.9 then 8.3
      when p_speed_kmh < 10.5 then 9.8
      when p_speed_kmh < 12.1 then 11.0
      when p_speed_kmh < 13.7 then 11.8
      when p_speed_kmh < 15.3 then 12.8
      else 14.5 end
    when 'walk' then case
      when p_speed_kmh is null or p_speed_kmh <= 0 or p_speed_kmh > 12 then 3.5
      when p_speed_kmh < 3.6 then 2.8
      when p_speed_kmh < 4.4 then 3.0
      when p_speed_kmh < 5.2 then 3.5
      when p_speed_kmh < 6.0 then 4.3
      when p_speed_kmh < 6.8 then 5.0
      else 7.0 end
    when 'bike' then case
      when p_speed_kmh is null or p_speed_kmh <= 0 or p_speed_kmh > 60 then 7.0
      when p_speed_kmh < 16 then 4.0
      when p_speed_kmh < 19.3 then 6.8
      when p_speed_kmh < 22.5 then 8.0
      when p_speed_kmh < 25.7 then 10.0
      else 12.0 end
    when 'row' then 7.0
    when 'swim' then 6.0
    when 'hiit' then 8.0
    else 5.0
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- Estimate for one session. Internal: called by the trigger below (inside finish_workout_session,
-- which runs as the function owner) and by the backfill at the end of this migration.
create or replace function public.estimate_session_kcal(p_session uuid, p_user uuid, p_kind text, p_duration integer)
returns table (kcal integer, weight_kg numeric)
language plpgsql stable set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
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
  select pp.start_weight_kg, pp.sex, pp.birth_year into v_weight, v_sex, v_birth
  from public.profile_private pp where pp.user_id = p_user;
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

-- ---------------------------------------------------------------------------------------------
-- Compute on finish (internal updates only). Recomputes when ended_at changes or the estimate was
-- cleared by an internal update (backfill / future weight corrections).
create or replace function public.set_session_energy()
returns trigger language plpgsql set search_path = public as $$
declare
  e record;
begin
  if not public.is_internal() or new.ended_at is null then
    return new;
  end if;
  if old.ended_at is not distinct from new.ended_at and new.kcal_estimate is not null then
    return new;
  end if;
  select * into e from public.estimate_session_kcal(new.id, new.user_id, new.kind, new.duration_sec);
  new.kcal_estimate := e.kcal;
  new.kcal_weight_kg := e.weight_kg;
  return new;
end;
$$;

drop trigger if exists workout_sessions_set_energy on public.workout_sessions;
create trigger workout_sessions_set_energy before update on public.workout_sessions
  for each row execute function public.set_session_energy();

-- Clients can never write the estimate (extends the column protection from 20261026070000).
create or replace function public.protect_workout_session_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.is_internal() then return new; end if;
  if tg_op = 'INSERT' then
    new.ended_at := null;
    new.duration_sec := null;
    new.total_sets := 0;
    new.total_volume_kg := 0;
    new.kcal_estimate := null;
    new.kcal_weight_kg := null;
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
  new.kcal_estimate := old.kcal_estimate;
  new.kcal_weight_kg := old.kcal_weight_kg;
  return new;
end;
$$;

revoke execute on function public.strength_met(numeric), public.cardio_met(text, numeric),
  public.estimate_session_kcal(uuid, uuid, text, integer), public.set_session_energy(),
  public.protect_workout_session_columns()
  from public, anon, authenticated;

-- Backfill sessions finished before this migration.
select set_config('app.internal', 'on', false);
update public.workout_sessions set kcal_estimate = null where ended_at is not null;
select set_config('app.internal', 'off', false);
