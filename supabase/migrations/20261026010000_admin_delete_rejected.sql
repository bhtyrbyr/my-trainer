-- Admin: permanently delete a REJECTED registration and everything it owns.
-- Storage objects cannot be deleted in SQL (storage.protect_delete), so the admin client first removes the
-- user's avatar folder through the Storage API (allowed by the policy below), then calls this RPC, which
-- deletes the auth user; every public table cascades from auth.users.

drop policy if exists "avatars_admin_delete" on storage.objects;
create policy "avatars_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public.is_admin());

create or replace function public.admin_delete_rejected_user(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  target public.profiles%rowtype;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'CANNOT_CHANGE_SELF'; end if;

  select * into target from public.profiles where user_id = p_user;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if target.role = 'admin' then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if target.status <> 'rejected' then raise exception 'NOT_REJECTED' using errcode = 'P0001'; end if;

  delete from auth.users where id = p_user;
end;
$$;

revoke all on function public.admin_delete_rejected_user(uuid) from public, anon;
grant execute on function public.admin_delete_rejected_user(uuid) to authenticated;
