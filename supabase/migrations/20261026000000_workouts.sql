-- =============================================================================
-- my-trainer / Faz 1: exercise catalog, workouts, personal records, points integration
-- Spec: docs/faz1-spec.md sections 1-4. Points rules: docs/PRD.md section 1.4 (table point_rules).
--
-- Access model recap:
--   * Catalog tables (muscles, muscle_aliases, exercises where is_custom = false, exercise_catalog_meta)
--     are read-only for authenticated users with can_access(); writes only by service_role (no policy,
--     RLS bypass) from scripts/sync-exercises.mjs.
--   * Custom exercises and every workout table: owner-only, `user_id = auth.uid() and public.can_access()`.
--   * Points are awarded ONLY inside finish_workout_session() (security definer) and revoked by
--     after-delete triggers. Clients never touch point_events.
--   * Storage bucket exercise-media is private: read via signed URLs, uploads only by service_role.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Catalog tables
-- -----------------------------------------------------------------------------
create table if not exists public.muscles (
  wger_id integer primary key,
  name_latin text not null,
  name_en text not null,
  name_tr text,
  is_front boolean not null,
  svg_main_path text,          -- storage path in exercise-media, e.g. muscles/main/1.svg
  svg_secondary_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.muscle_aliases (
  exercisedb_name text primary key,   -- e.g. 'pectorals'
  wger_id integer references public.muscles(wger_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,            -- ExerciseDB exerciseId, null for custom
  source text not null default 'exercisedb' check (source in ('exercisedb', 'custom')),
  name_en text not null check (char_length(name_en) between 1 and 120),
  name_tr text check (name_tr is null or char_length(name_tr) between 1 and 120),
  body_parts text[] not null default '{}',
  target_muscles text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  equipment text[] not null default '{}',
  instructions_en text[] not null default '{}',
  instructions_tr text[],
  gif_path text,                      -- storage path in exercise-media, e.g. gifs/<external_id>.gif
  is_custom boolean not null default false,
  user_id uuid references auth.users(id) on delete cascade,   -- only for custom rows
  search tsvector generated always as (
    to_tsvector('simple', coalesce(name_en, '') || ' ' || coalesce(name_tr, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- custom rows must have an owner, catalog rows must not
  constraint exercises_custom_owner_chk check ((is_custom and user_id is not null) or (not is_custom and user_id is null))
);
create index if not exists exercises_search_idx on public.exercises using gin (search);
create index if not exists exercises_target_muscles_idx on public.exercises using gin (target_muscles);
create index if not exists exercises_custom_user_idx on public.exercises (is_custom, user_id);
create index if not exists exercises_body_parts_idx on public.exercises using gin (body_parts);
create index if not exists exercises_equipment_idx on public.exercises using gin (equipment);

create table if not exists public.exercise_catalog_meta (
  source text primary key,
  item_count integer,
  synced_at timestamptz,
  license_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at triggers (catalog)
drop trigger if exists muscles_set_updated_at on public.muscles;
create trigger muscles_set_updated_at before update on public.muscles
  for each row execute function public.set_updated_at();
drop trigger if exists muscle_aliases_set_updated_at on public.muscle_aliases;
create trigger muscle_aliases_set_updated_at before update on public.muscle_aliases
  for each row execute function public.set_updated_at();
drop trigger if exists exercises_set_updated_at on public.exercises;
create trigger exercises_set_updated_at before update on public.exercises
  for each row execute function public.set_updated_at();
drop trigger if exists exercise_catalog_meta_set_updated_at on public.exercise_catalog_meta;
create trigger exercise_catalog_meta_set_updated_at before update on public.exercise_catalog_meta
  for each row execute function public.set_updated_at();

-- Client writes to exercises are ALWAYS custom rows owned by the caller. service_role / postgres
-- (auth.uid() is null) are left untouched so the sync script can upsert catalog rows.
create or replace function public.force_custom_exercise()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null then
    new.is_custom := true;
    new.source := 'custom';
    new.external_id := null;
    new.user_id := auth.uid();
    new.gif_path := case when tg_op = 'UPDATE' then old.gif_path else null end;  -- clients cannot point at catalog media
    if tg_op = 'UPDATE' then
      new.id := old.id;
      new.created_at := old.created_at;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists exercises_force_custom on public.exercises;
create trigger exercises_force_custom before insert or update on public.exercises
  for each row execute function public.force_custom_exercise();

-- RLS: catalog
alter table public.muscles enable row level security;
drop policy if exists "muscles_read" on public.muscles;
create policy "muscles_read" on public.muscles for select to authenticated
  using (public.can_access());

alter table public.muscle_aliases enable row level security;
drop policy if exists "muscle_aliases_read" on public.muscle_aliases;
create policy "muscle_aliases_read" on public.muscle_aliases for select to authenticated
  using (public.can_access());

alter table public.exercise_catalog_meta enable row level security;
drop policy if exists "exercise_catalog_meta_read" on public.exercise_catalog_meta;
create policy "exercise_catalog_meta_read" on public.exercise_catalog_meta for select to authenticated
  using (public.can_access());

alter table public.exercises enable row level security;
drop policy if exists "exercises_read" on public.exercises;
create policy "exercises_read" on public.exercises for select to authenticated
  using (public.can_access() and (not is_custom or user_id = auth.uid()));
drop policy if exists "exercises_custom_insert" on public.exercises;
create policy "exercises_custom_insert" on public.exercises for insert to authenticated
  with check (is_custom and user_id = auth.uid() and public.can_access());
drop policy if exists "exercises_custom_update" on public.exercises;
create policy "exercises_custom_update" on public.exercises for update to authenticated
  using (is_custom and user_id = auth.uid() and public.can_access())
  with check (is_custom and user_id = auth.uid() and public.can_access());
drop policy if exists "exercises_custom_delete" on public.exercises;
create policy "exercises_custom_delete" on public.exercises for delete to authenticated
  using (is_custom and user_id = auth.uid() and public.can_access());
-- Catalog rows (is_custom = false): no insert/update/delete policy -> service_role only.

-- -----------------------------------------------------------------------------
-- 2. Workout tables (owner-only)
-- -----------------------------------------------------------------------------
create table if not exists public.workout_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  notes text,
  color text,
  sort_order integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workout_templates_user_created_idx on public.workout_templates (user_id, created_at);
create index if not exists workout_templates_user_sort_idx on public.workout_templates (user_id, archived, sort_order);

create table if not exists public.template_exercises (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.workout_templates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  position integer not null,
  target_sets integer not null default 3 check (target_sets between 1 and 50),
  target_reps_low integer not null default 8 check (target_reps_low between 1 and 500),
  target_reps_high integer not null default 12 check (target_reps_high between 1 and 500),
  rest_seconds integer not null default 90 check (rest_seconds between 0 and 3600),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists template_exercises_template_pos_idx on public.template_exercises (template_id, position);
create index if not exists template_exercises_user_created_idx on public.template_exercises (user_id, created_at);
create index if not exists template_exercises_exercise_idx on public.template_exercises (exercise_id);

create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template_id uuid references public.workout_templates(id) on delete set null,
  kind text not null check (kind in ('strength', 'cardio')),
  title text check (title is null or char_length(title) <= 120),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_sec integer check (duration_sec is null or duration_sec >= 0),
  notes text,
  total_volume_kg numeric(10,1) not null default 0,
  total_sets integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workout_sessions_user_started_idx on public.workout_sessions (user_id, started_at desc);
create index if not exists workout_sessions_template_idx on public.workout_sessions (template_id);

create table if not exists public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete restrict,  -- history survives; a used custom exercise cannot be deleted
  position integer not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists session_exercises_session_pos_idx on public.session_exercises (session_id, position);
create index if not exists session_exercises_user_created_idx on public.session_exercises (user_id, created_at);
create index if not exists session_exercises_user_exercise_idx on public.session_exercises (user_id, exercise_id);

create table if not exists public.session_sets (
  id uuid primary key default gen_random_uuid(),
  session_exercise_id uuid not null references public.session_exercises(id) on delete cascade,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  set_no integer not null check (set_no >= 1),
  weight_kg numeric(6,2) check (weight_kg is null or weight_kg between 0 and 2000),
  reps integer check (reps is null or reps between 0 and 1000),
  rpe numeric(3,1) check (rpe is null or rpe between 1 and 10),
  is_warmup boolean not null default false,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists session_sets_user_completed_idx on public.session_sets (user_id, completed_at);
create index if not exists session_sets_session_idx on public.session_sets (session_id);
create index if not exists session_sets_session_exercise_idx on public.session_sets (session_exercise_id, set_no);

create table if not exists public.cardio_entries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  activity text not null check (activity in ('run', 'walk', 'bike', 'row', 'swim', 'hiit', 'other')),
  duration_sec integer not null check (duration_sec between 1 and 86400),
  distance_m integer check (distance_m is null or distance_m between 0 and 1000000),
  avg_hr integer check (avg_hr is null or avg_hr between 30 and 250),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cardio_entries_user_created_idx on public.cardio_entries (user_id, created_at);
create index if not exists cardio_entries_session_idx on public.cardio_entries (session_id);

-- One PR row per (user, exercise, day): finish_workout_session() upserts it, so the row set always
-- mirrors the point_events ref (exercise_id || ':' || achieved_on).
create table if not exists public.personal_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  session_set_id uuid references public.session_sets(id) on delete cascade,
  weight_kg numeric(6,2),
  reps integer,
  e1rm numeric(7,2) not null,
  achieved_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, exercise_id, achieved_on)
);
create index if not exists personal_records_user_exercise_e1rm_idx on public.personal_records (user_id, exercise_id, e1rm desc);
create index if not exists personal_records_user_achieved_idx on public.personal_records (user_id, achieved_on);
create index if not exists personal_records_session_set_idx on public.personal_records (session_set_id);

-- updated_at triggers (workouts)
drop trigger if exists workout_templates_set_updated_at on public.workout_templates;
create trigger workout_templates_set_updated_at before update on public.workout_templates
  for each row execute function public.set_updated_at();
drop trigger if exists template_exercises_set_updated_at on public.template_exercises;
create trigger template_exercises_set_updated_at before update on public.template_exercises
  for each row execute function public.set_updated_at();
drop trigger if exists workout_sessions_set_updated_at on public.workout_sessions;
create trigger workout_sessions_set_updated_at before update on public.workout_sessions
  for each row execute function public.set_updated_at();
drop trigger if exists session_exercises_set_updated_at on public.session_exercises;
create trigger session_exercises_set_updated_at before update on public.session_exercises
  for each row execute function public.set_updated_at();
drop trigger if exists session_sets_set_updated_at on public.session_sets;
create trigger session_sets_set_updated_at before update on public.session_sets
  for each row execute function public.set_updated_at();
drop trigger if exists cardio_entries_set_updated_at on public.cardio_entries;
create trigger cardio_entries_set_updated_at before update on public.cardio_entries
  for each row execute function public.set_updated_at();
drop trigger if exists personal_records_set_updated_at on public.personal_records;
create trigger personal_records_set_updated_at before update on public.personal_records
  for each row execute function public.set_updated_at();

-- Anti-IDOR integrity: a child row may only reference a parent owned by the same user, and an exercise that
-- is either catalog or the user's own custom one. Runs as the caller (RLS applies), so a foreign parent is
-- simply invisible and the insert fails. Args: tg_argv[0] = parent table, tg_argv[1] = fk column.
create or replace function public.assert_child_owner()
returns trigger language plpgsql set search_path = public as $$
declare
  parent_table text := tg_argv[0];
  fk_column text := tg_argv[1];
  fk_value uuid;
  ok boolean;
begin
  fk_value := (to_jsonb(new) ->> fk_column)::uuid;
  execute format('select exists (select 1 from public.%I p where p.id = $1 and p.user_id = $2)', parent_table)
    into ok using fk_value, new.user_id;
  if not coalesce(ok, false) then
    raise exception 'FORBIDDEN: % does not belong to user', parent_table using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.assert_exercise_visible()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1 from public.exercises e
    where e.id = new.exercise_id and (not e.is_custom or e.user_id = new.user_id)
  ) then
    raise exception 'FORBIDDEN: exercise not accessible' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- session_sets: session_id is derived from the parent session_exercise (client value is ignored).
create or replace function public.session_sets_fill_session()
returns trigger language plpgsql set search_path = public as $$
declare
  v_session uuid;
begin
  select se.session_id into v_session
  from public.session_exercises se
  where se.id = new.session_exercise_id and se.user_id = new.user_id;
  if v_session is null then
    raise exception 'FORBIDDEN: session_exercise does not belong to user' using errcode = '42501';
  end if;
  new.session_id := v_session;
  return new;
end;
$$;

drop trigger if exists template_exercises_assert_owner on public.template_exercises;
create trigger template_exercises_assert_owner before insert or update of template_id, user_id on public.template_exercises
  for each row execute function public.assert_child_owner('workout_templates', 'template_id');
drop trigger if exists template_exercises_assert_exercise on public.template_exercises;
create trigger template_exercises_assert_exercise before insert or update of exercise_id, user_id on public.template_exercises
  for each row execute function public.assert_exercise_visible();

drop trigger if exists workout_sessions_assert_template on public.workout_sessions;
create trigger workout_sessions_assert_template before insert or update of template_id, user_id on public.workout_sessions
  for each row when (new.template_id is not null) execute function public.assert_child_owner('workout_templates', 'template_id');

drop trigger if exists session_exercises_assert_owner on public.session_exercises;
create trigger session_exercises_assert_owner before insert or update of session_id, user_id on public.session_exercises
  for each row execute function public.assert_child_owner('workout_sessions', 'session_id');
drop trigger if exists session_exercises_assert_exercise on public.session_exercises;
create trigger session_exercises_assert_exercise before insert or update of exercise_id, user_id on public.session_exercises
  for each row execute function public.assert_exercise_visible();

drop trigger if exists session_sets_fill_session on public.session_sets;
create trigger session_sets_fill_session before insert or update of session_exercise_id, session_id, user_id on public.session_sets
  for each row execute function public.session_sets_fill_session();

drop trigger if exists cardio_entries_assert_owner on public.cardio_entries;
create trigger cardio_entries_assert_owner before insert or update of session_id, user_id on public.cardio_entries
  for each row execute function public.assert_child_owner('workout_sessions', 'session_id');

-- RLS: owner-only on every workout table
alter table public.workout_templates enable row level security;
drop policy if exists "workout_templates_owner_all" on public.workout_templates;
create policy "workout_templates_owner_all" on public.workout_templates for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());

alter table public.template_exercises enable row level security;
drop policy if exists "template_exercises_owner_all" on public.template_exercises;
create policy "template_exercises_owner_all" on public.template_exercises for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());

alter table public.workout_sessions enable row level security;
drop policy if exists "workout_sessions_owner_all" on public.workout_sessions;
create policy "workout_sessions_owner_all" on public.workout_sessions for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());

alter table public.session_exercises enable row level security;
drop policy if exists "session_exercises_owner_all" on public.session_exercises;
create policy "session_exercises_owner_all" on public.session_exercises for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());

alter table public.session_sets enable row level security;
drop policy if exists "session_sets_owner_all" on public.session_sets;
create policy "session_sets_owner_all" on public.session_sets for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());

alter table public.cardio_entries enable row level security;
drop policy if exists "cardio_entries_owner_all" on public.cardio_entries;
create policy "cardio_entries_owner_all" on public.cardio_entries for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());

-- personal_records are derived server-side (finish_workout_session). Owner may read and delete
-- (delete revokes the PR points); no client insert/update.
alter table public.personal_records enable row level security;
drop policy if exists "personal_records_owner_read" on public.personal_records;
create policy "personal_records_owner_read" on public.personal_records for select to authenticated
  using (user_id = auth.uid() and public.can_access());
drop policy if exists "personal_records_owner_delete" on public.personal_records;
create policy "personal_records_owner_delete" on public.personal_records for delete to authenticated
  using (user_id = auth.uid() and public.can_access());

-- -----------------------------------------------------------------------------
-- 3. Server logic
-- -----------------------------------------------------------------------------
-- Epley estimated 1RM. Null for missing weight / reps < 1.
create or replace function public.e1rm(p_weight numeric, p_reps integer)
returns numeric language sql immutable as $$
  select case
    when p_weight is null or p_reps is null or p_reps < 1 or p_weight <= 0 then null
    else round(p_weight * (1 + p_reps / 30.0), 2)
  end
$$;

-- Points revocation triggers (security definer: award/revoke_points are executable only by the owner / service_role)
create or replace function public.workout_sessions_revoke_points()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.revoke_points(old.user_id, 'workout_sessions', old.id::text);
  return old;
end;
$$;
drop trigger if exists workout_sessions_revoke_points on public.workout_sessions;
create trigger workout_sessions_revoke_points after delete on public.workout_sessions
  for each row execute function public.workout_sessions_revoke_points();

create or replace function public.personal_records_revoke_points()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.revoke_points(old.user_id, 'personal_records', old.exercise_id::text || ':' || old.achieved_on::text);
  return old;
end;
$$;
drop trigger if exists personal_records_revoke_points on public.personal_records;
create trigger personal_records_revoke_points after delete on public.personal_records
  for each row execute function public.personal_records_revoke_points();

-- finish_workout_session: closes the session, recomputes totals, awards points, detects PRs.
-- Security definer so it may call award_points(); the first statement verifies ownership via auth.uid().
create or replace function public.finish_workout_session(p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
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

  -- totals over non-warmup sets with a weight and at least one rep
  select coalesce(count(*), 0)::int, coalesce(sum(coalesce(ss.weight_kg, 0) * coalesce(ss.reps, 0)), 0)
    into v_total_sets, v_total_volume
  from public.session_sets ss
  where ss.session_id = p_session and not ss.is_warmup and coalesce(ss.reps, 0) >= 1;

  -- duration: wall clock, or the logged cardio time for cardio sessions
  v_duration := greatest(0, floor(extract(epoch from (v_now - s.started_at)))::int);
  if s.kind = 'cardio' then
    select sum(ce.duration_sec)::int into v_cardio_duration from public.cardio_entries ce where ce.session_id = p_session;
    if v_cardio_duration is not null and v_cardio_duration > 0 then
      v_duration := v_cardio_duration;
    end if;
  end if;

  update public.workout_sessions
     set ended_at = v_now,
         duration_sec = v_duration,
         total_sets = v_total_sets,
         total_volume_kg = v_total_volume
   where id = p_session;

  v_date := v_now::date;  -- same session timezone as current_date inside award_points()

  -- session points
  if s.kind = 'strength' and v_total_sets >= 1 then
    v_points := v_points + public.award_points(s.user_id, 'workout_strength', v_date, 'workout_sessions', s.id::text, 50 + 2 * v_total_sets);
  elsif s.kind = 'cardio' and v_duration >= 1 then
    v_points := v_points + public.award_points(s.user_id, 'workout_cardio', v_date, 'workout_sessions', s.id::text, 30 + floor(v_duration / 300.0)::int);
  end if;

  -- PR detection: best non-warmup set per exercise, compared with the user's all-time best e1rm
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

      v_pr_points := public.award_points(s.user_id, 'personal_record', v_date, 'personal_records', rec.exercise_id::text || ':' || v_date::text);
      v_points := v_points + coalesce(v_pr_points, 0);

      v_new_prs := v_new_prs || jsonb_build_object(
        'exercise_id', rec.exercise_id,
        'e1rm', rec.e1rm,
        'weight_kg', rec.weight_kg,
        'reps', rec.reps
      );
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

-- "What did I do last time": sets of the previous p_limit finished sessions containing this exercise.
-- Security invoker: RLS restricts to the caller's rows.
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
      and exists (select 1 from public.session_exercises se where se.session_id = ws.id and se.exercise_id = p_exercise)
    order by ws.started_at desc
    limit greatest(coalesce(p_limit, 1), 1)
  )
  select p.session_id, p.started_at, se.id, ss.id, ss.set_no, ss.weight_kg, ss.reps, ss.rpe, ss.is_warmup, ss.completed_at
  from picked p
  join public.session_exercises se on se.session_id = p.session_id and se.exercise_id = p_exercise
  join public.session_sets ss on ss.session_exercise_id = se.id
  order by p.started_at desc, se.position, ss.set_no
$$;

-- Trend chart: per finished session, best e1rm and total volume for one exercise. Security invoker.
create or replace function public.exercise_progress(p_exercise uuid)
returns table (
  session_id uuid,
  started_at timestamptz,
  best_e1rm numeric,
  best_weight_kg numeric,
  total_volume_kg numeric,
  total_sets integer
)
language sql stable set search_path = public as $$
  select ws.id, ws.started_at,
         max(public.e1rm(ss.weight_kg, ss.reps)) as best_e1rm,
         max(ss.weight_kg) as best_weight_kg,
         coalesce(sum(coalesce(ss.weight_kg, 0) * coalesce(ss.reps, 0)), 0) as total_volume_kg,
         count(*)::int as total_sets
  from public.workout_sessions ws
  join public.session_exercises se on se.session_id = ws.id and se.exercise_id = p_exercise
  join public.session_sets ss on ss.session_exercise_id = se.id
  where ws.user_id = auth.uid()
    and ws.ended_at is not null
    and not ss.is_warmup
    and coalesce(ss.reps, 0) >= 1
  group by ws.id, ws.started_at
  order by ws.started_at
$$;

-- -----------------------------------------------------------------------------
-- 4. Grants (never anon; RPCs only to authenticated; award/revoke stay service_role-only)
-- -----------------------------------------------------------------------------
revoke all on table
  public.muscles, public.muscle_aliases, public.exercises, public.exercise_catalog_meta,
  public.workout_templates, public.template_exercises, public.workout_sessions,
  public.session_exercises, public.session_sets, public.cardio_entries, public.personal_records
from anon, public;

revoke all on function public.e1rm(numeric, integer) from public, anon;
revoke all on function public.finish_workout_session(uuid) from public, anon;
revoke all on function public.last_sets_for_exercise(uuid, integer) from public, anon;
revoke all on function public.exercise_progress(uuid) from public, anon;
revoke all on function public.force_custom_exercise() from public, anon;
revoke all on function public.assert_child_owner() from public, anon;
revoke all on function public.assert_exercise_visible() from public, anon;
revoke all on function public.session_sets_fill_session() from public, anon;
revoke all on function public.workout_sessions_revoke_points() from public, anon;
revoke all on function public.personal_records_revoke_points() from public, anon;

grant execute on function public.e1rm(numeric, integer) to authenticated, service_role;
grant execute on function public.finish_workout_session(uuid) to authenticated;
grant execute on function public.last_sets_for_exercise(uuid, integer) to authenticated;
grant execute on function public.exercise_progress(uuid) to authenticated;
-- Trigger functions run with the invoking role; authenticated needs execute on them.
grant execute on function public.force_custom_exercise(), public.assert_child_owner(), public.assert_exercise_visible(),
  public.session_sets_fill_session(), public.workout_sessions_revoke_points(), public.personal_records_revoke_points()
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Storage: exercise-media (private; read via signed URLs; uploads only by service_role from the sync script)
-- NOTE: never DELETE from storage.objects in SQL (blocked by storage.protect_delete); use the Storage API.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-media', 'exercise-media', false, 5242880, array['image/gif', 'image/svg+xml', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "exercise_media_read" on storage.objects;
create policy "exercise_media_read" on storage.objects for select to authenticated
  using (bucket_id = 'exercise-media' and public.can_access());
-- No insert/update/delete policies: service_role bypasses RLS.
