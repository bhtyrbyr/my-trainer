-- Faz 2, step 5: end-to-end encrypted progress photos (M9).
--
-- Zero knowledge: the browser strips EXIF, resizes, and encrypts image, thumbnail and note with
-- AES-256-GCM under a random master key. The server stores only:
--   photo_vault      the master key wrapped under a password-derived key and under a recovery-code
--                    key, plus the KDF parameters (never the password, code or key)
--   progress_photos  ciphertext locations, IVs, the encrypted note, the day and the pose
--                    (day and pose stay plaintext for ordering, comparison and weekly points)
--   storage          bucket progress-photos/<user_id>/<photo_id>.(img|thumb).bin, octet-stream only
-- Points: progress_photo 25, once a week (seeded rule), revoked when the photo is deleted.

create table if not exists public.photo_vault (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kdf jsonb not null,
  wrapped_key text not null check (char_length(wrapped_key) between 40 and 200),
  wrap_iv text not null check (char_length(wrap_iv) between 12 and 40),
  recovery_kdf jsonb not null,
  recovery_wrapped_key text not null check (char_length(recovery_wrapped_key) between 40 and 200),
  recovery_iv text not null check (char_length(recovery_iv) between 12 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.progress_photos (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  taken_on date not null,
  pose text not null check (pose in ('front', 'side', 'back', 'other')),
  image_path text not null,
  thumb_path text not null,
  image_iv text not null check (char_length(image_iv) between 12 and 40),
  thumb_iv text not null check (char_length(thumb_iv) between 12 and 40),
  meta_cipher text check (meta_cipher is null or char_length(meta_cipher) <= 4000),
  meta_iv text check (meta_iv is null or char_length(meta_iv) between 12 and 40),
  created_at timestamptz not null default now()
);
create index if not exists progress_photos_user_day_idx on public.progress_photos (user_id, taken_on desc);

alter table public.photo_vault enable row level security;
alter table public.progress_photos enable row level security;
drop policy if exists "photo_vault_owner_all" on public.photo_vault;
create policy "photo_vault_owner_all" on public.photo_vault for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());
drop policy if exists "progress_photos_owner_all" on public.progress_photos;
create policy "progress_photos_owner_all" on public.progress_photos for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());

drop trigger if exists photo_vault_set_updated_at on public.photo_vault;
create trigger photo_vault_set_updated_at before update on public.photo_vault
  for each row execute function public.set_updated_at();

-- Paths must live in the owner's folder and match the photo id; no future days; immutable owner/id/paths.
create or replace function public.progress_photos_guard()
returns trigger language plpgsql set search_path = public set timezone = 'Europe/Istanbul' as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.user_id := old.user_id;
    new.image_path := old.image_path;
    new.thumb_path := old.thumb_path;
  else
    if new.image_path <> new.user_id::text || '/' || new.id::text || '.img.bin'
       or new.thumb_path <> new.user_id::text || '/' || new.id::text || '.thumb.bin' then
      raise exception 'BAD_PATH' using errcode = 'P0001';
    end if;
  end if;
  if new.taken_on > current_date then
    raise exception 'FUTURE_DATE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists progress_photos_guard on public.progress_photos;
create trigger progress_photos_guard before insert or update on public.progress_photos
  for each row execute function public.progress_photos_guard();

create or replace function public.progress_photos_points()
returns trigger language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
begin
  if tg_op = 'DELETE' then
    perform public.revoke_points(old.user_id, 'progress_photos', old.id::text);
    return old;
  end if;
  perform public.award_points(new.user_id, 'progress_photo', new.taken_on, 'progress_photos', new.id::text);
  return new;
end;
$$;
drop trigger if exists progress_photos_points on public.progress_photos;
create trigger progress_photos_points after insert or delete on public.progress_photos
  for each row execute function public.progress_photos_points();

revoke execute on function public.progress_photos_guard(), public.progress_photos_points() from public, anon, authenticated;

-- Storage: private bucket, ciphertext only (application/octet-stream), 6 MB per object, owner folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 6291456, array['application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "progress_photos_owner_insert" on storage.objects;
create policy "progress_photos_owner_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text and public.can_access());
drop policy if exists "progress_photos_owner_read" on storage.objects;
create policy "progress_photos_owner_read" on storage.objects for select to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text and public.can_access());
drop policy if exists "progress_photos_owner_delete" on storage.objects;
create policy "progress_photos_owner_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);
