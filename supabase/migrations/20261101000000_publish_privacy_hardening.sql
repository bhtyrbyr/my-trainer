-- Pre-publication privacy audit (2026-10-30).

-- 1. Avatars: the bucket stays public so <img> works from the plain object URL (an unguessable
--    <uid>/... path), but nobody can LIST it any more. The old "public read" policy let an anonymous
--    caller enumerate every user id and download every profile photo. Listing/select is now the
--    owner's own folder, or an admin (deleting a rejected registration).
drop policy if exists "avatars_public_read" on storage.objects;
drop policy if exists "avatars_owner_read" on storage.objects;
create policy "avatars_owner_read" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- 2. app_config holds the admin's e-mail (admin_bootstrap_email); only admins read it. Server-side
--    code reads it through security-definer functions, which are unaffected.
drop policy if exists "app_config_read" on public.app_config;
create policy "app_config_read" on public.app_config for select to authenticated using (public.is_admin());

-- 3. Defense in depth: the anon role (not signed in) needs no table at all, and nobody needs
--    TRUNCATE/REFERENCES/TRIGGER (TRUNCATE is not subject to RLS). RLS stays the real lock.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;
