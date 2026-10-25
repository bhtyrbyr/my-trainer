-- Supabase blocks direct DELETEs on storage.objects (storage.protect_delete). Account deletion therefore
-- removes files through the Storage API from the client (owner policies allow it) BEFORE calling this RPC,
-- which only deletes the auth user (cascading to every user table).
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  delete from auth.users where id = uid;
end;
$$;
