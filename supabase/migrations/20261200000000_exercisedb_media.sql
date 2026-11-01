-- ExerciseDB GIFs return as hot-linked media (product owner, 2026-11-02).
--
-- * Catalog names are English only: name_tr is cleared on catalog rows (column kept; custom rows untouched).
-- * exercises.exercisedb_id: the ExerciseDB id. The client hot-links https://static.exercisedb.dev/media/<id>.gif;
--   nothing is copied to our storage. exercises.exercisedb_match records how the id was found
--   (exact | fuzzy | ai | manual). Both null or both set.
-- * Writes: service_role only (scripts/sync-catalog.mjs). Catalog rows already have no client
--   insert/update/delete policy (RLS, 20261026000000_workouts.sql); force_custom_exercise() is extended so
--   a client can neither set nor change the two columns on its own custom rows either (same rule as
--   media_frames / attribution: clients cannot point at catalog media).
-- * Read access unchanged ("exercises_read"). No new RPCs.

-- 1. English-only catalog names
update public.exercises set name_tr = null where not is_custom and name_tr is not null;

-- 2. Columns + checks
alter table public.exercises add column if not exists exercisedb_id text;
alter table public.exercises add column if not exists exercisedb_match text;

alter table public.exercises drop constraint if exists exercises_exercisedb_id_chk;
alter table public.exercises add constraint exercises_exercisedb_id_chk
  check (exercisedb_id is null or exercisedb_id ~ '^[A-Za-z0-9]{4,16}$');

alter table public.exercises drop constraint if exists exercises_exercisedb_match_chk;
alter table public.exercises add constraint exercises_exercisedb_match_chk
  check (exercisedb_match is null or exercisedb_match in ('exact', 'fuzzy', 'ai', 'manual'));

alter table public.exercises drop constraint if exists exercises_exercisedb_pair_chk;
alter table public.exercises add constraint exercises_exercisedb_pair_chk
  check ((exercisedb_id is null) = (exercisedb_match is null));

comment on column public.exercises.exercisedb_id is 'ExerciseDB id; media hot-linked from https://static.exercisedb.dev/media/<id>.gif (never stored). Written by service_role only.';
comment on column public.exercises.exercisedb_match is 'How exercisedb_id was matched: exact | fuzzy | ai | manual. Null exactly when exercisedb_id is null.';

-- 3. Admin "unmatched" list
create index if not exists exercises_exercisedb_unmatched_idx on public.exercises (name_en)
  where exercisedb_id is null and source in ('wger', 'workout-guide');

-- 4. Client writes stay custom-only and cannot attach catalog media (redefined from 20261104000000).
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
