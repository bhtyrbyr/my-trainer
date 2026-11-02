-- v1.1.1: the admin picks the ExerciseDB GIF for a catalog exercise by hand.
--
-- * admin_set_exercise_media(exercise, id): admin only (FORBIDDEN, 42501), catalog rows only
--   (source wger | workout-guide, not custom; NOT_CATALOG, 22023; unknown id NOT_FOUND, P0002).
--   A non-null id is trimmed, must match ^[A-Za-z0-9]{4,16}$ (BAD_VALUE, 22023) and is stored with
--   exercisedb_match = 'manual', which scripts/sync-catalog.mjs never overwrites. A null id clears both
--   columns, so the next sync may match the row again.
-- * The search itself runs in the exercisedb-search Edge Function (third-party call, CLAUDE.md rule 4);
--   nothing from ExerciseDB is stored except the id.
-- * force_custom_exercise() (BEFORE INSERT/UPDATE on exercises) rewrites every write made while
--   auth.uid() is set into a custom row. The RPC runs with the admin's JWT, so the trigger now steps aside
--   while public.is_internal() is on (set transaction-locally by our own security-definer functions only,
--   same pattern as the profiles/points protection triggers). Client writes are unchanged.

-- 1. Let our own security-definer functions write catalog rows (redefined from 20261200000000).
create or replace function public.force_custom_exercise()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_internal() then
    new.is_custom := true;
    new.source := 'custom';
    new.external_id := null;
    new.user_id := auth.uid();
    new.media_frames := case when tg_op = 'UPDATE' then old.media_frames else '{}' end;  -- clients cannot point at catalog media
    new.attribution := case when tg_op = 'UPDATE' then old.attribution else null end;
    new.exercisedb_id := case when tg_op = 'UPDATE' then old.exercisedb_id else null end;
    new.exercisedb_match := case when tg_op = 'UPDATE' then old.exercisedb_match else null end;
    if tg_op = 'UPDATE' then
      new.id := old.id;
      new.created_at := old.created_at;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.force_custom_exercise() from public, anon, authenticated;

-- 2. The admin RPC
create or replace function public.admin_set_exercise_media(p_exercise_id uuid, p_exercisedb_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_id text := nullif(btrim(p_exercisedb_id), '');
  v_row record;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_exercise_id is null then raise exception 'BAD_VALUE' using errcode = '22023'; end if;
  if p_exercisedb_id is not null and (v_id is null or v_id !~ '^[A-Za-z0-9]{4,16}$') then
    raise exception 'BAD_VALUE' using errcode = '22023';
  end if;

  select e.is_custom, e.source into v_row from public.exercises e where e.id = p_exercise_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.is_custom or v_row.source not in ('wger', 'workout-guide') then
    raise exception 'NOT_CATALOG' using errcode = '22023';
  end if;

  perform set_config('app.internal', 'on', true);
  update public.exercises
     set exercisedb_id = v_id,
         exercisedb_match = case when v_id is null then null else 'manual' end
   where id = p_exercise_id;
  perform set_config('app.internal', 'off', true);
end;
$$;
revoke all on function public.admin_set_exercise_media(uuid, text) from public, anon;
grant execute on function public.admin_set_exercise_media(uuid, text) to authenticated;
comment on function public.admin_set_exercise_media(uuid, text) is
  'Admin only: pin a catalog exercise to an ExerciseDB id (match = manual, kept by the sync) or clear it (null).';
