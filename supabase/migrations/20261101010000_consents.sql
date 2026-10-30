-- KVKK: privacy-notice acknowledgement and explicit consent for health data (2026-10-30).
--
-- user_consents is an append-only log (who acknowledged/consented to which text version, when; also
-- withdrawals). Clients never write it directly: record_consent() and withdraw_health_consent() do.
-- Health data (body metrics, meals, sleep, water, progress photos) is special-category data under
-- KVKK art. 6, so those tables are readable/writable only while the latest health_data row is a grant.

create table if not exists public.user_consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('privacy_notice', 'health_data')),
  version text not null check (char_length(version) between 1 and 20),
  granted boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists user_consents_user_kind_idx on public.user_consents (user_id, kind, id desc);

alter table public.user_consents enable row level security;
drop policy if exists "user_consents_owner_read" on public.user_consents;
create policy "user_consents_owner_read" on public.user_consents for select to authenticated
  using (user_id = auth.uid() and public.can_access());
-- no insert/update/delete policies: the log is written only by the functions below

-- Acknowledge the privacy notice or grant health-data consent. Works before approval too (the notice
-- is acknowledged during onboarding), but never for a blocked account.
create or replace function public.record_consent(p_kind text, p_version text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where user_id = auth.uid() and is_blocked) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_kind not in ('privacy_notice', 'health_data') then
    raise exception 'BAD_KIND' using errcode = '22023';
  end if;
  insert into public.user_consents (user_id, kind, version, granted) values (auth.uid(), p_kind, left(p_version, 20), true);
end;
$$;
revoke execute on function public.record_consent(text, text) from public, anon;
grant execute on function public.record_consent(text, text) to authenticated;

-- Used inside RLS policies (so it must be executable by authenticated); answers only for the caller.
create or replace function public.has_health_consent()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.granted from public.user_consents c
      where c.user_id = auth.uid() and c.kind = 'health_data'
      order by c.id desc limit 1),
    false)
$$;
revoke execute on function public.has_health_consent() from public, anon;
grant execute on function public.has_health_consent() to authenticated;

-- Withdrawal: log it and erase the health data (points earned from it are revoked by the existing
-- delete triggers). The client then removes the encrypted photo files through the Storage API
-- (Supabase blocks direct deletes on storage.objects; owner delete policies allow it).
create or replace function public.withdraw_health_consent(p_version text)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.can_access() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  insert into public.user_consents (user_id, kind, version, granted) values (uid, 'health_data', left(p_version, 20), false);
  delete from public.body_metrics where user_id = uid;
  delete from public.meal_entries where user_id = uid;
  delete from public.sleep_entries where user_id = uid;
  delete from public.water_entries where user_id = uid;
  delete from public.progress_photos where user_id = uid;
  delete from public.photo_vault where user_id = uid;
end;
$$;
revoke execute on function public.withdraw_health_consent(text) from public, anon;
grant execute on function public.withdraw_health_consent(text) to authenticated;

-- Health tables: owner AND consent. (select ...) keeps it one evaluation per statement.
drop policy if exists "body_metrics_owner_all" on public.body_metrics;
create policy "body_metrics_owner_all" on public.body_metrics for all to authenticated
  using (user_id = auth.uid() and public.can_access() and (select public.has_health_consent()))
  with check (user_id = auth.uid() and public.can_access() and (select public.has_health_consent()));
drop policy if exists "meal_entries_owner_all" on public.meal_entries;
create policy "meal_entries_owner_all" on public.meal_entries for all to authenticated
  using (user_id = auth.uid() and public.can_access() and (select public.has_health_consent()))
  with check (user_id = auth.uid() and public.can_access() and (select public.has_health_consent()));
drop policy if exists "sleep_entries_owner_all" on public.sleep_entries;
create policy "sleep_entries_owner_all" on public.sleep_entries for all to authenticated
  using (user_id = auth.uid() and public.can_access() and (select public.has_health_consent()))
  with check (user_id = auth.uid() and public.can_access() and (select public.has_health_consent()));
drop policy if exists "water_entries_owner_all" on public.water_entries;
create policy "water_entries_owner_all" on public.water_entries for all to authenticated
  using (user_id = auth.uid() and public.can_access() and (select public.has_health_consent()))
  with check (user_id = auth.uid() and public.can_access() and (select public.has_health_consent()));
drop policy if exists "progress_photos_owner_all" on public.progress_photos;
create policy "progress_photos_owner_all" on public.progress_photos for all to authenticated
  using (user_id = auth.uid() and public.can_access() and (select public.has_health_consent()))
  with check (user_id = auth.uid() and public.can_access() and (select public.has_health_consent()));
drop policy if exists "photo_vault_owner_select" on public.photo_vault;
create policy "photo_vault_owner_select" on public.photo_vault for select to authenticated
  using (user_id = auth.uid() and public.can_access() and (select public.has_health_consent()));
drop policy if exists "photo_vault_owner_insert" on public.photo_vault;
create policy "photo_vault_owner_insert" on public.photo_vault for insert to authenticated
  with check (user_id = auth.uid() and public.can_access() and (select public.has_health_consent()));
drop policy if exists "photo_vault_owner_update" on public.photo_vault;
create policy "photo_vault_owner_update" on public.photo_vault for update to authenticated
  using (user_id = auth.uid() and public.can_access() and (select public.has_health_consent()))
  with check (user_id = auth.uid() and public.can_access() and (select public.has_health_consent()));

-- New encrypted photo uploads also need the consent (reading/deleting own files does not, so a
-- withdrawal can still clean up).
drop policy if exists "progress_photos_owner_insert" on storage.objects;
create policy "progress_photos_owner_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ ('^' || auth.uid()::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(img|thumb)\.bin$')
    and public.progress_photo_object_count() < 1000
    and public.can_access()
    and (select public.has_health_consent())
  );

-- Account deletion must not leave the app without an administrator.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if exists (select 1 from public.profiles where user_id = uid and role = 'admin')
     and not exists (select 1 from public.profiles where role = 'admin' and user_id <> uid and not is_blocked) then
    raise exception 'LAST_ADMIN' using errcode = 'P0001';
  end if;
  delete from auth.users where id = uid;
end;
$$;
