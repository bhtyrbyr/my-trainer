-- Faz 4: admin panel RPCs (docs/faz4-spec.md section 1, PRD M13).
--
-- Every function is security definer, re-checks is_admin() first (FORBIDDEN, 42501) and validates its
-- input (22023). Admins cannot block themselves or another admin. Per-user AI limits stay in
-- user_settings.ai_daily_limit (user_settings_protect lets admins change it).

-- ---------------------------------------------------------------------------------------------
-- App config: only the keys the panel edits, each with its own shape.
create or replace function public.admin_set_config(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_key is null or p_value is null then raise exception 'BAD_VALUE' using errcode = '22023'; end if;
  case p_key
    when 'access_mode' then
      if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') not in ('open', 'invite') then
        raise exception 'BAD_VALUE' using errcode = '22023';
      end if;
    when 'require_approval' then
      if jsonb_typeof(p_value) <> 'boolean' then
        raise exception 'BAD_VALUE' using errcode = '22023';
      end if;
    when 'ai_global_daily_limit' then
      if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric <> trunc((p_value #>> '{}')::numeric)
         or (p_value #>> '{}')::numeric not between 0 and 10000 then
        raise exception 'BAD_VALUE' using errcode = '22023';
      end if;
    else
      raise exception 'BAD_KEY' using errcode = '22023';
  end case;
  insert into public.app_config (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Invite list (enforced only while access_mode = 'invite')
create or replace function public.admin_list_allowed_emails()
returns table (email text, note text, added_by uuid, added_by_username text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
    select a.email::text, a.note, a.added_by, p.username::text, a.created_at
    from public.allowed_emails a
    left join public.profiles p on p.user_id = a.added_by
    order by a.created_at desc, a.email;
end;
$$;

create or replace function public.admin_add_allowed_email(p_email text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'BAD_EMAIL' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'BAD_NOTE' using errcode = '22023';
  end if;
  insert into public.allowed_emails (email, note, added_by) values (v_email, v_note, auth.uid())
  on conflict (email) do update set note = excluded.note;
end;
$$;

-- Returns whether an entry was removed.
create or replace function public.admin_remove_allowed_email(p_email text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_rows integer;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.allowed_emails where email = lower(btrim(coalesce(p_email, '')));
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Users: search (username, display name, e-mail), block/unblock, per-user AI limit.
create or replace function public.admin_list_users(p_query text default null, p_limit integer default 50)
returns table (
  user_id uuid,
  username text,
  display_name text,
  email text,
  status text,
  role text,
  is_blocked boolean,
  created_at timestamptz,
  last_active_on date,
  ai_daily_limit integer,
  avatar_path text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_pattern text;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_q is not null then
    if char_length(v_q) > 100 then raise exception 'BAD_QUERY' using errcode = '22023'; end if;
    v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
    select p.user_id, p.username::text, p.display_name, u.email::text, p.status, p.role, p.is_blocked,
           p.created_at, p.last_active_on, us.ai_daily_limit, p.avatar_path
    from public.profiles p
    join auth.users u on u.id = p.user_id
    left join public.user_settings us on us.user_id = p.user_id
    where v_pattern is null
       or p.username::text ilike v_pattern
       or p.display_name ilike v_pattern
       or u.email::text ilike v_pattern
    order by p.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

create or replace function public.admin_set_blocked(p_user uuid, p_blocked boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  target public.profiles%rowtype;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_user is null or p_blocked is null then raise exception 'BAD_VALUE' using errcode = '22023'; end if;
  if p_user = auth.uid() then raise exception 'CANNOT_CHANGE_SELF' using errcode = 'P0001'; end if;
  select * into target from public.profiles where user_id = p_user;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_blocked and target.role = 'admin' then raise exception 'TARGET_IS_ADMIN' using errcode = 'P0001'; end if;
  update public.profiles set is_blocked = p_blocked where user_id = p_user;
end;
$$;

create or replace function public.admin_set_ai_limit(p_user uuid, p_limit integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_user is null or p_limit is null or p_limit not between 0 and 1000 then
    raise exception 'BAD_VALUE' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where user_id = p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.user_settings (user_id, ai_daily_limit) values (p_user, p_limit)
  on conflict (user_id) do update set ai_daily_limit = excluded.ai_daily_limit;
end;
$$;

-- ---------------------------------------------------------------------------------------------
revoke execute on function
  public.admin_set_config(text, jsonb),
  public.admin_list_allowed_emails(),
  public.admin_add_allowed_email(text, text),
  public.admin_remove_allowed_email(text),
  public.admin_list_users(text, integer),
  public.admin_set_blocked(uuid, boolean),
  public.admin_set_ai_limit(uuid, integer)
  from public, anon;
grant execute on function
  public.admin_set_config(text, jsonb),
  public.admin_list_allowed_emails(),
  public.admin_add_allowed_email(text, text),
  public.admin_remove_allowed_email(text),
  public.admin_list_users(text, integer),
  public.admin_set_blocked(uuid, boolean),
  public.admin_set_ai_limit(uuid, integer)
  to authenticated;
