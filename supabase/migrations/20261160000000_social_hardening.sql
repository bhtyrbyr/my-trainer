-- Social hardening (QA findings on 20261140000000_social.sql, which is already deployed).
--  1. Daily post/like limits count creations in a log that survives deletes; per-owner daily upload cap.
--  2. A private account's group posts are visible only to active members; member lists only to members.
--  3. Group bans (remove_member bans by default; join, join-by-code and invite respect bans; unban + list).
--  4. Strict payload validation (types, bounds, array lengths; workout "best" is {reps, weight_kg}).
--  5. join-by-code: at most 20 failed attempts per user per hour (a failed attempt returns null).
--  6. Like/unlike repeats count against the 200/day cap.
--  7. Blocking removes and bans the blocked user from groups the blocker owns or administers.
-- Idempotent: create if not exists / create or replace / drop ... if exists.

-- -----------------------------------------------------------------------------
-- A. Activity log (rate limits that survive deletes). Internal only; kept 2 days.
-- -----------------------------------------------------------------------------
create table if not exists private.social_activity (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('post', 'like', 'join_code_fail')),
  period_start timestamptz not null,
  count integer not null default 0 check (count >= 0),
  primary key (user_id, kind, period_start)
);
alter table private.social_activity enable row level security;
revoke all on private.social_activity from public, anon, authenticated;

create or replace function private.social_activity_count(p_user uuid, p_kind text, p_since timestamptz)
returns integer language sql stable set search_path = private as $$
  select coalesce(sum(a.count), 0)::int from private.social_activity a
   where a.user_id = p_user and a.kind = p_kind and a.period_start >= p_since
$$;

create or replace function private.social_activity_bump(p_user uuid, p_kind text, p_bucket timestamptz)
returns void language sql volatile set search_path = private as $$
  insert into private.social_activity as a (user_id, kind, period_start, count) values (p_user, p_kind, p_bucket, 1)
  on conflict (user_id, kind, period_start) do update set count = a.count + 1
$$;

-- Every created post / like is logged (any insert path), bucketed by the app's calendar day.
create or replace function private.social_log_post()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  perform private.social_activity_bump(new.author_id, 'post', private.social_today());
  return null;
end;
$$;
drop trigger if exists posts_log_activity on public.posts;
create trigger posts_log_activity after insert on public.posts
  for each row execute function private.social_log_post();

create or replace function private.social_log_like()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  perform private.social_activity_bump(new.user_id, 'like', private.social_today());
  return null;
end;
$$;
drop trigger if exists post_likes_log_activity on public.post_likes;
create trigger post_likes_log_activity after insert on public.post_likes
  for each row execute function private.social_log_like();

-- -----------------------------------------------------------------------------
-- B. Group bans. No direct client access (RLS on, no policies, no grants); read via group_bans_list.
-- -----------------------------------------------------------------------------
create table if not exists public.group_bans (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  banned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_bans_user_created_idx on public.group_bans (user_id, created_at desc);
alter table public.group_bans enable row level security;
revoke all on public.group_bans from public, anon, authenticated;

create or replace function private.group_banned(p_group uuid, p_user uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.group_bans where group_id = p_group and user_id = p_user)
$$;

-- -----------------------------------------------------------------------------
-- C. Payload validation
-- -----------------------------------------------------------------------------
create or replace function private.jnum_in(v jsonb, lo numeric, hi numeric)
returns boolean language sql immutable as $$
  select coalesce(jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between lo and hi, false)
$$;

create or replace function private.social_payload_valid(p_kind text, p jsonb)
returns boolean language plpgsql immutable set search_path = private as $$
declare
  e jsonb;
  d jsonb;
  b jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 16384 then
    return false;
  end if;
  if p_kind = 'workout' then
    if not private.jkeys_ok(p, array['date', 'duration_sec', 'volume_kg', 'sets', 'exercises'],
                               array['date', 'duration_sec', 'volume_kg', 'sets', 'exercises'])
       or not private.jstr_ok(p -> 'date', 10) or (p ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$'
       or not private.jnum_in(p -> 'duration_sec', 0, 604800)
       or not private.jnum_in(p -> 'volume_kg', 0, 1000000)
       or not private.jnum_in(p -> 'sets', 0, 10000)
       or jsonb_typeof(p -> 'exercises') <> 'array' or jsonb_array_length(p -> 'exercises') > 30 then
      return false;
    end if;
    for e in select x from jsonb_array_elements(p -> 'exercises') x loop
      if not private.jkeys_ok(e, array['name', 'best'], array['name']) or not private.jstr_ok(e -> 'name', 120) then
        return false;
      end if;
      if e ? 'best' then
        b := e -> 'best';
        if not private.jkeys_ok(b, array['reps', 'weight_kg'], array['reps', 'weight_kg'])
           or not private.jnum_in(b -> 'reps', 0, 1000)
           or not (jsonb_typeof(b -> 'weight_kg') = 'null' or private.jnum_in(b -> 'weight_kg', 0, 2000)) then
          return false;
        end if;
      end if;
    end loop;
    return true;
  elsif p_kind = 'program' then
    if not private.jkeys_ok(p, array['name', 'days'], array['name', 'days'])
       or not private.jstr_ok(p -> 'name', 120)
       or jsonb_typeof(p -> 'days') <> 'array' or jsonb_array_length(p -> 'days') not between 1 and 7 then
      return false;
    end if;
    for d in select x from jsonb_array_elements(p -> 'days') x loop
      if not private.jkeys_ok(d, array['name', 'exercises'], array['name', 'exercises'])
         or not private.jstr_ok(d -> 'name', 120)
         or jsonb_typeof(d -> 'exercises') <> 'array' or jsonb_array_length(d -> 'exercises') > 30 then
        return false;
      end if;
      for e in select x from jsonb_array_elements(d -> 'exercises') x loop
        if not private.jkeys_ok(e, array['name', 'exercise_id', 'sets', 'reps_low', 'reps_high'],
                                   array['name', 'sets', 'reps_low', 'reps_high'])
           or not private.jstr_ok(e -> 'name', 120)
           or not private.jnum_in(e -> 'sets', 0, 100)
           or not private.jnum_in(e -> 'reps_low', 0, 1000) or not private.jnum_in(e -> 'reps_high', 0, 1000)
           or (e ? 'exercise_id' and jsonb_typeof(e -> 'exercise_id') <> 'null'
               and not private.jstr_ok(e -> 'exercise_id', 64)) then
          return false;
        end if;
      end loop;
    end loop;
    return true;
  elsif p_kind = 'meal' then
    return private.jkeys_ok(p, array['name', 'kcal', 'protein_g', 'carb_g', 'fat_g'], array['kcal', 'protein_g', 'carb_g', 'fat_g'])
       and (not p ? 'name' or private.jstr_ok(p -> 'name', 120))
       and private.jnum_in(p -> 'kcal', 0, 50000) and private.jnum_in(p -> 'protein_g', 0, 5000)
       and private.jnum_in(p -> 'carb_g', 0, 5000) and private.jnum_in(p -> 'fat_g', 0, 5000);
  elsif p_kind in ('text', 'photo', 'progress', 'compare') then
    return p = '{}'::jsonb;
  end if;
  return false;
end;
$$;

-- -----------------------------------------------------------------------------
-- D. Visibility: a private account's group posts reach active members only
-- -----------------------------------------------------------------------------
create or replace function public.can_view_post(p_post uuid)
returns boolean language sql stable security definer set search_path = public, private as $$
  select coalesce((
    select p.author_id = v.me or (
             private.social_active(v.me) and private.social_active(p.author_id)
             and not private.blocked_either(v.me, p.author_id)
             and (p.kind not in ('photo', 'progress', 'compare')
                  or exists (select 1 from public.post_media m where m.post_id = p.id))
             and case p.audience
               when 'public' then not sp.is_private or private.follows_accepted(v.me, p.author_id)
               when 'followers' then private.follows_accepted(v.me, p.author_id)
               when 'friends' then private.follows_accepted(v.me, p.author_id) and private.follows_accepted(p.author_id, v.me)
               when 'group' then private.group_role(p.group_id, p.author_id) is not null
                                 and (private.group_role(p.group_id, v.me) is not null
                                      or (g.visibility = 'open' and not sp.is_private))
               else false end)
      from public.posts p
      join public.social_profiles sp on sp.user_id = p.author_id
      left join public.groups g on g.id = p.group_id
      cross join (select auth.uid() as me) v
     where p.id = p_post and v.me is not null and public.can_access()), false)
$$;

-- Upload: as before, plus a per-owner daily cap (40 objects, 20 MB, counted from storage.objects).
create or replace function public.social_media_upload_ok(p_name text)
returns boolean language plpgsql stable security definer set search_path = public, private, storage as $$
declare
  v uuid := auth.uid();
  v_post uuid;
begin
  if v is null or p_name is null
     or p_name !~ ('^' || v::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|webp)$') then
    return false;
  end if;
  v_post := split_part(p_name, '/', 2)::uuid;
  return public.can_access() and private.social_active(v)
     and exists (select 1 from public.posts p where p.id = v_post and p.author_id = v
                    and p.created_at > now() - interval '10 minutes')
     and (select count(*) from storage.objects o
           where o.bucket_id = 'social-media' and o.name like v::text || '/' || v_post::text || '/%') < 4
     and (select count(*) < 40
                 and coalesce(sum(case when jsonb_typeof(o.metadata -> 'size') = 'number'
                                       then (o.metadata ->> 'size')::numeric else 0 end), 0) < 20971520
            from storage.objects o
           where o.bucket_id = 'social-media' and o.name like v::text || '/%'
             and o.created_at >= private.social_today());
end;
$$;

-- -----------------------------------------------------------------------------
-- E. Posts and likes: limits from the activity log
-- -----------------------------------------------------------------------------
create or replace function public.social_create_post(p_kind text, p_body text default null,
  p_payload jsonb default '{}'::jsonb, p_audience text default 'followers', p_group uuid default null)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_id uuid;
begin
  if p_kind is null or p_kind not in ('text', 'workout', 'program', 'meal', 'photo', 'progress', 'compare') then
    raise exception 'BAD_KIND' using errcode = '22023';
  end if;
  if (v_body is not null and char_length(v_body) > 1000) or (p_kind = 'text' and v_body is null) then
    raise exception 'BAD_BODY' using errcode = '22023';
  end if;
  if not private.social_payload_valid(p_kind, v_payload) then
    raise exception 'BAD_PAYLOAD' using errcode = '22023';
  end if;
  perform private.check_audience(v, p_audience, p_group);
  perform pg_advisory_xact_lock(hashtextextended('social:' || v::text, 0));
  if private.social_activity_count(v, 'post', private.social_today()) >= 20 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  insert into public.posts (author_id, kind, body, payload, audience, group_id)
  values (v, p_kind, v_body, v_payload, p_audience, p_group)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.social_like(p_post uuid)
returns integer language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
begin
  if not public.can_view_post(p_post) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('social:' || v::text, 0));
  if not exists (select 1 from public.post_likes where post_id = p_post and user_id = v) then
    if private.social_activity_count(v, 'like', private.social_today()) >= 200 then
      raise exception 'RATE_LIMITED' using errcode = 'P0001';
    end if;
    insert into public.post_likes (post_id, user_id) values (p_post, v);
  end if;
  return (select like_count from public.posts where id = p_post);
end;
$$;

-- -----------------------------------------------------------------------------
-- F. Blocking also removes and bans the blocked user from groups the blocker runs
-- -----------------------------------------------------------------------------
create or replace function public.social_block(p_user uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := auth.uid();
begin
  if v is null or not public.can_access() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_user is null or p_user = v or not exists (select 1 from public.profiles where user_id = p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (v, p_user) on conflict do nothing;
  delete from public.follows
   where (follower_id = v and followee_id = p_user) or (follower_id = p_user and followee_id = v);
  delete from public.post_likes l using public.posts p
   where p.id = l.post_id
     and ((l.user_id = p_user and p.author_id = v) or (l.user_id = v and p.author_id = p_user));
  delete from public.social_notifications
   where (user_id = v and actor_id = p_user) or (user_id = p_user and actor_id = v);
  delete from public.group_members
   where status = 'invited'
     and ((user_id = v and invited_by = p_user) or (user_id = p_user and invited_by = v));
  -- Owner: any membership, request or invitation of the blocked user; admin: plain members only.
  insert into public.group_bans (group_id, user_id, banned_by)
  select t.group_id, p_user, v
    from public.group_members t
    join public.group_members me on me.group_id = t.group_id and me.user_id = v and me.status = 'active'
   where t.user_id = p_user and (me.role = 'owner' or (me.role = 'admin' and t.role = 'member'))
  on conflict do nothing;
  delete from public.group_members t using public.group_members me
   where t.user_id = p_user and me.group_id = t.group_id and me.user_id = v and me.status = 'active'
     and (me.role = 'owner' or (me.role = 'admin' and t.role = 'member'));
end;
$$;

-- -----------------------------------------------------------------------------
-- G. Groups: bans, join-by-code attempt limit, member lists for members only
-- -----------------------------------------------------------------------------
create or replace function public.group_join(p_group uuid)
returns text language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
  v_vis text;
  v_status text;
begin
  select g.visibility into v_vis from public.groups g where g.id = p_group and private.group_visible(p_group, v);
  if v_vis is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if private.group_banned(p_group, v) then raise exception 'GROUP_BANNED' using errcode = 'P0001'; end if;
  select status into v_status from public.group_members where group_id = p_group and user_id = v;
  if v_status in ('active', 'pending') then return v_status; end if;
  if v_status = 'invited' or v_vis = 'open' then
    perform private.group_assert_capacity(p_group);
    insert into public.group_members (group_id, user_id, status) values (p_group, v, 'active')
    on conflict (group_id, user_id) do update set status = 'active';
    return 'active';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('social:' || v::text, 0));
  if (select count(*) from public.group_members where user_id = v and created_at >= private.social_today()) >= 30 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  insert into public.group_members (group_id, user_id, status) values (p_group, v, 'pending');
  return 'pending';
end;
$$;

-- A wrong code returns null (an exception would roll back the attempt log); 20 failures per hour -> RATE_LIMITED.
create or replace function public.group_join_by_code(p_code text)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
  v_group uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('social:' || v::text, 0));
  if private.social_activity_count(v, 'join_code_fail', now() - interval '1 hour') >= 20 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  select g.id into v_group from public.groups g where g.invite_code = upper(btrim(coalesce(p_code, '')));
  if v_group is null or not private.group_visible(v_group, v) then
    perform private.social_activity_bump(v, 'join_code_fail', date_trunc('minute', now()));
    return null;
  end if;
  if private.group_banned(v_group, v) then raise exception 'GROUP_BANNED' using errcode = 'P0001'; end if;
  if exists (select 1 from public.group_members where group_id = v_group and user_id = v and status = 'active') then
    return v_group;
  end if;
  perform private.group_assert_capacity(v_group);
  insert into public.group_members (group_id, user_id, status) values (v_group, v, 'active')
  on conflict (group_id, user_id) do update set status = 'active';
  return v_group;
end;
$$;

create or replace function public.group_invite(p_group uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
  v_status text;
begin
  if coalesce(private.group_role(p_group, v), '') not in ('owner', 'admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_user is null or p_user = v or not private.social_active(p_user) or private.blocked_either(v, p_user)
     or not private.group_visible(p_group, p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if private.group_banned(p_group, p_user) then raise exception 'USER_BANNED' using errcode = 'P0001'; end if;
  select status into v_status from public.group_members where group_id = p_group and user_id = p_user;
  if v_status in ('active', 'invited') then return; end if;
  if v_status = 'pending' then  -- inviting someone who asked = approving the request
    perform private.group_assert_capacity(p_group);
    update public.group_members set status = 'active' where group_id = p_group and user_id = p_user;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('social:' || v::text, 0));
  if (select count(*) from public.group_members where invited_by = v and created_at >= private.social_today()) >= 50 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  insert into public.group_members (group_id, user_id, status, invited_by) values (p_group, p_user, 'invited', v);
end;
$$;

-- Owner/admin removes a member, request or invitation (banned unless p_ban = false); only the owner
-- removes admins; nobody removes the owner.
drop function if exists public.group_remove_member(uuid, uuid);
create or replace function public.group_remove_member(p_group uuid, p_user uuid, p_ban boolean default true)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
  v_role text := private.group_role(p_group, v);
  v_target text;
begin
  if coalesce(v_role, '') not in ('owner', 'admin') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select role into v_target from public.group_members where group_id = p_group and user_id = p_user;
  if v_target is null or p_user = v then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_target = 'owner' or (v_target = 'admin' and v_role <> 'owner') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
  if coalesce(p_ban, true) then
    insert into public.group_bans (group_id, user_id, banned_by) values (p_group, p_user, v) on conflict do nothing;
  end if;
end;
$$;

create or replace function public.group_unban(p_group uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
begin
  if coalesce(private.group_role(p_group, v), '') not in ('owner', 'admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  delete from public.group_bans where group_id = p_group and user_id = p_user;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
end;
$$;

create or replace function public.group_bans_list(p_group uuid)
returns table (user_id uuid, username text, display_name text, avatar_path text, banned_by uuid, banned_at timestamptz)
language plpgsql stable security definer set search_path = public, private as $$
#variable_conflict use_column
declare
  v uuid := private.social_me();
begin
  if coalesce(private.group_role(p_group, v), '') not in ('owner', 'admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select p.user_id, p.username::text, p.display_name, p.avatar_path, b.banned_by, b.created_at
      from public.group_bans b join public.profiles p on p.user_id = b.user_id
     where b.group_id = p_group
     order by b.created_at desc
     limit 500;
end;
$$;

-- Members of any group are listed to its active members only (non-members get the count via social_group).
-- Owners and admins also see requests and invitations.
create or replace function public.social_group_members(p_group uuid)
returns table (user_id uuid, username text, display_name text, avatar_path text, role text, status text, joined_at timestamptz)
language plpgsql stable security definer set search_path = public, private as $$
#variable_conflict use_column
declare
  v uuid := private.social_viewer();
  v_role text;
begin
  if v is null then return; end if;
  v_role := private.group_role(p_group, v);
  if v_role is null or not private.group_visible(p_group, v) then
    return;
  end if;
  return query
    select p.user_id, p.username::text, p.display_name, p.avatar_path, gm.role, gm.status, gm.created_at
      from public.group_members gm join public.profiles p on p.user_id = gm.user_id
     where gm.group_id = p_group
       and (gm.status = 'active' or v_role in ('owner', 'admin'))
       and (gm.user_id = v or (private.social_active(gm.user_id) and not private.blocked_either(v, gm.user_id)))
     order by case gm.role when 'owner' then 0 when 'admin' then 1 else 2 end, gm.created_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- H. Retention: the activity log is kept 2 days
-- -----------------------------------------------------------------------------
create or replace function private.social_retention()
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  n_notif integer; n_reports integer; n_posts integer; n_activity integer;
begin
  delete from public.social_notifications where created_at < now() - interval '60 days';
  get diagnostics n_notif = row_count;
  delete from public.reports where status = 'resolved' and coalesce(resolved_at, created_at) < now() - interval '30 days';
  get diagnostics n_reports = row_count;
  delete from public.posts p
   where p.kind in ('photo', 'progress', 'compare') and p.created_at < now() - interval '1 hour'
     and not exists (select 1 from public.post_media m where m.post_id = p.id);
  get diagnostics n_posts = row_count;
  delete from private.social_activity where period_start < now() - interval '2 days';
  get diagnostics n_activity = row_count;
  return jsonb_build_object('social_notifications', n_notif, 'reports', n_reports, 'empty_media_posts', n_posts,
                            'social_activity', n_activity);
end;
$$;

-- -----------------------------------------------------------------------------
-- I. Grants
-- -----------------------------------------------------------------------------
revoke all on function
  private.social_activity_count(uuid, text, timestamptz), private.social_activity_bump(uuid, text, timestamptz),
  private.social_log_post(), private.social_log_like(), private.group_banned(uuid, uuid),
  private.jnum_in(jsonb, numeric, numeric), private.social_payload_valid(text, jsonb), private.social_retention()
from public, anon, authenticated;
revoke all on function public.can_view_post(uuid), public.social_media_upload_ok(text) from public, anon;
grant execute on function public.can_view_post(uuid), public.social_media_upload_ok(text) to authenticated;
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.social_create_post(text, text, jsonb, text, uuid)', 'public.social_like(uuid)', 'public.social_block(uuid)',
    'public.group_join(uuid)', 'public.group_join_by_code(text)', 'public.group_invite(uuid, uuid)',
    'public.group_remove_member(uuid, uuid, boolean)', 'public.group_unban(uuid, uuid)', 'public.group_bans_list(uuid)',
    'public.social_group_members(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
