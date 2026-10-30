-- ExerciseDB is gone (removed in production on 2026-10-30: 0 exercisedb rows, 0 GIFs). Drop what only
-- existed for it: the gif_path column and the 'exercisedb' source value.

-- 1. Functions that still write gif_path, redefined without it.
create or replace function public.force_custom_exercise()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null then
    new.is_custom := true;
    new.source := 'custom';
    new.external_id := null;
    new.user_id := auth.uid();
    new.media_frames := case when tg_op = 'UPDATE' then old.media_frames else '{}' end;  -- clients cannot point at catalog media
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

-- 2. Column and source value.
alter table public.exercises drop column if exists gif_path;
alter table public.exercises drop constraint if exists exercises_source_check;
alter table public.exercises add constraint exercises_source_check
  check (source in ('wger', 'workout-guide', 'legacy', 'custom'));
alter table public.exercises alter column source set default 'custom';
