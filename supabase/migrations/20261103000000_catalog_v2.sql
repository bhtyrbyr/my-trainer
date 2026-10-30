-- Exercise catalog v2 (docs/catalog-v2-spec.md, "Schema changes"): openly licensed sources replace ExerciseDB.
--
--  * exercises.media_frames: ordered storage paths in exercise-media (frames/<slug>/<n>.svg), played as a flipbook.
--  * exercises.attribution: { text: {author, license, url}, media: {author, license, url}, changes: text[] }.
--  * source check widened: exercisedb | wger | workout-guide | legacy | custom.
--  * replace_catalog_exercise(old, new) / retire_catalog_exercise(id): service_role only, used once by
--    scripts/sync-catalog.mjs --replace-legacy after the product owner has reviewed legacy-map.json.
--
-- Read access is unchanged: "exercises_read" is source-agnostic (catalog rows = not is_custom, so wger,
-- workout-guide and legacy rows are readable by signed-in users; custom rows only by their owner).
-- Library/pickers hide legacy rows client-side; history keeps showing their names.

-- ---------------------------------------------------------------------------------------------
-- 1. Columns + source check
alter table public.exercises add column if not exists media_frames text[] not null default '{}';
alter table public.exercises add column if not exists attribution jsonb;

alter table public.exercises drop constraint if exists exercises_attribution_chk;
alter table public.exercises add constraint exercises_attribution_chk
  check (attribution is null or jsonb_typeof(attribution) = 'object');

alter table public.exercises drop constraint if exists exercises_source_check;
alter table public.exercises add constraint exercises_source_check
  check (source in ('exercisedb', 'wger', 'workout-guide', 'legacy', 'custom'));

comment on column public.exercises.media_frames is 'Storage paths in exercise-media (frames/<slug>/<n>.svg), shown in order as a flipbook; empty = muscle map.';
comment on column public.exercises.attribution is 'Licence credit: { text: {author, license, url}, media: {author, license, url}, changes: text[] }.';

-- ---------------------------------------------------------------------------------------------
-- 2. Custom exercises still cannot point at catalog media or borrow a catalog credit line.
create or replace function public.force_custom_exercise()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null then
    new.is_custom := true;
    new.source := 'custom';
    new.external_id := null;
    new.user_id := auth.uid();
    new.gif_path := case when tg_op = 'UPDATE' then old.gif_path else null end;  -- clients cannot point at catalog media
    new.media_frames := case when tg_op = 'UPDATE' then old.media_frames else '{}' end;
    new.attribution := case when tg_op = 'UPDATE' then old.attribution else null end;
    if tg_op = 'UPDATE' then
      new.id := old.id;
      new.created_at := old.created_at;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.force_custom_exercise() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. replace_catalog_exercise: move every user reference from p_old to p_new, then delete p_old.
--
-- Foreign keys to public.exercises (checked against pg_constraint): template_exercises (cascade),
-- session_exercises (restrict), personal_records (cascade). session_sets hang off session_exercises,
-- so they follow their parent row unchanged.
--
--  * template_exercises: a template that already contains p_new loses its p_old entries (no duplicate
--    of the same exercise in one plan); everywhere else the entry is repointed and keeps its targets.
--  * session_exercises: always repointed (history; a session may then list the exercise twice).
--  * personal_records: rows are repointed. Only one row per (user, exercise, day) may exist, so when
--    both exercises have a PR row on the same day the higher e1rm survives (tie: p_new's row) and the
--    other is deleted. The surviving row keeps the larger of the two PR awards: point refs are swapped
--    first when needed, so the deleted row's revoke trigger takes back the smaller (or no) award. All
--    remaining PR point refs '<old>:<day>' are renamed '<new>:<day>' so a later delete still revokes.
--    The merged history may not be strictly increasing, but the best (max e1rm), which is what
--    finish_workout_session and the client use, is correct.
--  * Points are never awarded here; the only change is that duplicate same-day PR award.
create or replace function public.replace_catalog_exercise(p_old uuid, p_new uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old public.exercises%rowtype;
  v_new public.exercises%rowtype;
  v_tpl_dropped integer;
  v_tpl integer;
  v_sess integer;
  v_pr integer;
  v_pr_merged integer := 0;
  r record;
  v_loser_ref text;
  v_win_ref text;
  v_tmp_ref text;
  v_lp integer;
  v_wp integer;
begin
  if p_old is null or p_new is null or p_old = p_new then
    raise exception 'INVALID_ARGS' using errcode = '22023';
  end if;
  select * into v_old from public.exercises where id = p_old for update;
  if not found then raise exception 'NOT_FOUND: %', p_old using errcode = 'P0002'; end if;
  select * into v_new from public.exercises where id = p_new for update;
  if not found then raise exception 'NOT_FOUND: %', p_new using errcode = 'P0002'; end if;
  if v_old.is_custom or v_new.is_custom then
    raise exception 'NOT_CATALOG: only catalog exercises can be replaced' using errcode = '22023';
  end if;
  if v_new.source = 'legacy' then
    raise exception 'TARGET_IS_LEGACY' using errcode = '22023';
  end if;

  -- templates
  delete from public.template_exercises t
   where t.exercise_id = p_old
     and exists (select 1 from public.template_exercises x where x.template_id = t.template_id and x.exercise_id = p_new);
  get diagnostics v_tpl_dropped = row_count;
  update public.template_exercises set exercise_id = p_new where exercise_id = p_old;
  get diagnostics v_tpl = row_count;

  -- sessions (sets follow their session_exercise)
  update public.session_exercises set exercise_id = p_new where exercise_id = p_old;
  get diagnostics v_sess = row_count;

  -- personal records: same-day collisions first
  for r in
    select l.id as loser_id, l.exercise_id as loser_ex, w.exercise_id as win_ex, l.user_id, l.achieved_on
      from public.personal_records l
      join public.personal_records w on w.user_id = l.user_id and w.achieved_on = l.achieved_on
     where (l.exercise_id = p_old and w.exercise_id = p_new and l.e1rm <= w.e1rm)
        or (l.exercise_id = p_new and w.exercise_id = p_old and l.e1rm < w.e1rm)
  loop
    v_loser_ref := r.loser_ex::text || ':' || r.achieved_on::text;
    v_win_ref := r.win_ex::text || ':' || r.achieved_on::text;
    v_tmp_ref := 'swap:' || r.loser_id::text;
    select points into v_lp from public.point_events
     where user_id = r.user_id and ref_table = 'personal_records' and ref_id = v_loser_ref;
    select points into v_wp from public.point_events
     where user_id = r.user_id and ref_table = 'personal_records' and ref_id = v_win_ref;
    if v_lp is not null and (v_wp is null or v_lp > v_wp) then
      -- the surviving row takes the larger award (three steps: the ref is part of a unique key)
      update public.point_events set ref_id = v_tmp_ref
       where user_id = r.user_id and ref_table = 'personal_records' and ref_id = v_loser_ref;
      update public.point_events set ref_id = v_loser_ref
       where user_id = r.user_id and ref_table = 'personal_records' and ref_id = v_win_ref;
      update public.point_events set ref_id = v_win_ref
       where user_id = r.user_id and ref_table = 'personal_records' and ref_id = v_tmp_ref;
    end if;
    delete from public.personal_records where id = r.loser_id;  -- trigger revokes the loser's (smaller) award
    v_pr_merged := v_pr_merged + 1;
  end loop;

  update public.point_events e
     set ref_id = p_new::text || substr(e.ref_id, length(p_old::text) + 1)
   where e.ref_table = 'personal_records'
     and e.ref_id like p_old::text || ':%'
     and not exists (
       select 1 from public.point_events x
        where x.user_id = e.user_id and x.kind = e.kind and x.ref_table = e.ref_table
          and x.ref_id = p_new::text || substr(e.ref_id, length(p_old::text) + 1));
  update public.personal_records set exercise_id = p_new where exercise_id = p_old;
  get diagnostics v_pr = row_count;

  delete from public.exercises where id = p_old;

  return jsonb_build_object(
    'template_entries_repointed', v_tpl,
    'template_entries_dropped', v_tpl_dropped,
    'session_exercises_repointed', v_sess,
    'personal_records_repointed', v_pr,
    'personal_records_merged', v_pr_merged
  );
end;
$$;
revoke all on function public.replace_catalog_exercise(uuid, uuid) from public, anon, authenticated;
grant execute on function public.replace_catalog_exercise(uuid, uuid) to service_role;
comment on function public.replace_catalog_exercise(uuid, uuid) is
  'service_role only: repoint template/session/PR references from a catalog exercise to its replacement, then delete it. Never awards points.';

-- ---------------------------------------------------------------------------------------------
-- 4. retire_catalog_exercise: an unmapped catalog row. Referenced -> kept as 'legacy' (name only, so
--    history still reads) with media and instructions cleared; unreferenced -> deleted.
--    Returns 'retired' or 'deleted'.
create or replace function public.retire_catalog_exercise(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_ex public.exercises%rowtype;
begin
  select * into v_ex from public.exercises where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: %', p_id using errcode = 'P0002'; end if;
  if v_ex.is_custom then
    raise exception 'NOT_CATALOG: only catalog exercises can be retired' using errcode = '22023';
  end if;

  if exists (select 1 from public.template_exercises where exercise_id = p_id)
     or exists (select 1 from public.session_exercises where exercise_id = p_id)
     or exists (select 1 from public.personal_records where exercise_id = p_id) then
    update public.exercises
       set source = 'legacy',
           gif_path = null,
           instructions_en = '{}',
           instructions_tr = null,
           media_frames = '{}'
     where id = p_id;
    return 'retired';
  end if;

  delete from public.exercises where id = p_id;
  return 'deleted';
end;
$$;
revoke all on function public.retire_catalog_exercise(uuid) from public, anon, authenticated;
grant execute on function public.retire_catalog_exercise(uuid) to service_role;
comment on function public.retire_catalog_exercise(uuid) is
  'service_role only: keep a referenced catalog exercise as source=legacy (media/instructions cleared) or delete an unreferenced one.';
