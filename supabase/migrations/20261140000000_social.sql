-- =============================================================================
-- Social platform (docs/social-spec.md sections 1, 2 and the DB side of 5).
--   A  consent kind 'social', app_config.social_consent_version, user_settings.social_push
--   B  tables: social_profiles, follows, blocks, groups, group_members, posts, post_media, post_likes,
--      reports, social_notifications; private.storage_garbage (orphaned Storage objects)
--   C  internal helpers (private schema, never granted)
--   D  visibility: can_view_post(), can_view_profile() (+ Storage policy helpers)
--   E  triggers: like_count, notifications, media garbage, under-18 auto-disable, account deletion
--   F  RPCs (consent, follows, blocks, posts, likes, reads, notifications, groups, reports, admin)
--   G  Storage bucket social-media
--   H  dispatch_reminders also pushes social notifications (one collapsed push per user per 10 min)
--   I  retention cron, ops_claim_storage_garbage()
--
-- Table RLS is owner-only (select own rows; writes go through the definer RPCs, except post_media
-- inserts). Every cross-user read goes through an RPC that calls can_view_post / can_view_profile, so
-- "download my data" (select * per table) only ever returns the caller's own rows.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Consent, config, settings
-- -----------------------------------------------------------------------------
insert into public.app_config (key, value) values ('social_consent_version', '"2026-11-01"'::jsonb)
on conflict (key) do nothing;

alter table public.user_settings add column if not exists social_push boolean not null default true;

alter table public.user_consents drop constraint if exists user_consents_kind_check;
alter table public.user_consents add constraint user_consents_kind_check
  check (kind in ('privacy_notice', 'health_data', 'adult', 'ai_processing', 'social'));

-- Same rules as 20261120000000 (access check, dedupe, 20 a day) plus the kind 'social' (18+).
create or replace function public.record_consent(p_kind text, p_version text)
returns void language plpgsql security definer set search_path = public set "TimeZone" = 'Europe/Istanbul' as $$
declare
  v_uid uuid := auth.uid();
  v_version text := left(p_version, 20);
  v_last public.user_consents%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_kind not in ('privacy_notice', 'health_data', 'adult', 'ai_processing', 'social') then
    raise exception 'BAD_KIND' using errcode = '22023';
  end if;
  if not (public.can_access() or (p_kind = 'privacy_notice' and public.can_onboard())) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_kind in ('adult', 'ai_processing', 'social')
     and exists (select 1 from public.profile_private
                  where user_id = v_uid and birth_year > extract(year from current_date)::int - 18) then
    raise exception 'UNDERAGE' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('consent:' || v_uid::text, 0));
  select * into v_last from public.user_consents
   where user_id = v_uid and kind = p_kind order by id desc limit 1;
  if found and v_last.version = v_version and v_last.granted then
    return;  -- nothing changed
  end if;
  if (select count(*) from public.user_consents
       where user_id = v_uid and created_at >= current_date::timestamptz) >= 20 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  insert into public.user_consents (user_id, kind, version, granted) values (v_uid, p_kind, v_version, true);
end;
$$;
revoke all on function public.record_consent(text, text) from public, anon;
grant execute on function public.record_consent(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- B. Tables
-- -----------------------------------------------------------------------------
create table if not exists public.social_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  is_private boolean not null default true,
  discoverable boolean not null default true,
  bio text check (bio is null or char_length(bio) <= 160),
  enabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_profiles_enabled_idx on public.social_profiles (user_id) where enabled;

create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index if not exists follows_follower_created_idx on public.follows (follower_id, created_at desc);
create index if not exists follows_followee_idx on public.follows (followee_id, status, created_at desc);

create table if not exists public.blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id, blocker_id);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 3 and 60),
  description text check (description is null or char_length(description) <= 300),
  visibility text not null default 'open' check (visibility in ('open', 'closed')),
  invite_code text not null unique check (invite_code ~ '^[A-Z2-9]{10}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists groups_owner_created_idx on public.groups (owner_id, created_at);
create index if not exists groups_name_idx on public.groups (lower(name));

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  status text not null default 'active' check (status in ('active', 'pending', 'invited')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id),
  check (role = 'member' or status = 'active')
);
create unique index if not exists group_members_one_owner on public.group_members (group_id) where role = 'owner';
create index if not exists group_members_user_created_idx on public.group_members (user_id, created_at desc);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('text', 'workout', 'program', 'meal', 'photo', 'progress', 'compare')),
  body text check (body is null or char_length(body) <= 1000),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  audience text not null default 'followers' check (audience in ('public', 'followers', 'friends', 'group')),
  group_id uuid references public.groups(id) on delete cascade,
  like_count integer not null default 0 check (like_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((audience = 'group') = (group_id is not null))
);
create index if not exists posts_author_created_idx on public.posts (author_id, created_at desc);
create index if not exists posts_group_created_idx on public.posts (group_id, created_at desc) where group_id is not null;
create index if not exists posts_public_created_idx on public.posts (created_at desc) where audience = 'public';

create table if not exists public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  path text not null unique check (char_length(path) <= 200),
  width integer not null check (width between 1 and 2560),
  height integer not null check (height between 1 and 2560),
  position smallint not null check (position between 0 and 3),
  created_at timestamptz not null default now(),
  unique (post_id, position)
);
create index if not exists post_media_author_created_idx on public.post_media (author_id, created_at desc);

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists post_likes_user_created_idx on public.post_likes (user_id, created_at desc);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_kind text not null check (target_kind in ('post', 'user', 'group')),
  target_id uuid not null,
  reason text check (reason is null or char_length(reason) <= 300),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);
create unique index if not exists reports_open_unique on public.reports (reporter_id, target_kind, target_id) where status = 'open';
create index if not exists reports_reporter_created_idx on public.reports (reporter_id, created_at desc);
create index if not exists reports_status_created_idx on public.reports (status, created_at);

create table if not exists public.social_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('follow', 'follow_request', 'follow_accepted', 'like',
                                     'group_invite', 'group_request', 'group_accepted')),
  actor_id uuid references auth.users(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  pushed_at timestamptz
);
create index if not exists social_notifications_user_created_idx on public.social_notifications (user_id, created_at desc);
create index if not exists social_notifications_actor_created_idx on public.social_notifications (actor_id, created_at desc);
create index if not exists social_notifications_unpushed_idx on public.social_notifications (user_id) where pushed_at is null;

create table if not exists private.storage_garbage (
  path text not null,
  bucket text not null,
  created_at timestamptz not null default now(),
  primary key (bucket, path)
);
revoke all on private.storage_garbage from public, anon, authenticated;

drop trigger if exists social_profiles_set_updated_at on public.social_profiles;
create trigger social_profiles_set_updated_at before update on public.social_profiles
  for each row execute function public.set_updated_at();
drop trigger if exists groups_set_updated_at on public.groups;
create trigger groups_set_updated_at before update on public.groups
  for each row execute function public.set_updated_at();
drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at before update of body, payload, audience, group_id on public.posts
  for each row execute function public.set_updated_at();

-- RLS: owner-only reads; no client write policies except post_media insert (section D helpers).
alter table public.social_profiles enable row level security;
alter table public.follows enable row level security;
alter table public.blocks enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.posts enable row level security;
alter table public.post_media enable row level security;
alter table public.post_likes enable row level security;
alter table public.reports enable row level security;
alter table public.social_notifications enable row level security;
do $$
declare
  t record;
begin
  for t in select * from (values
      ('social_profiles', 'user_id = (select auth.uid())'),
      ('follows', '(follower_id = (select auth.uid()) or followee_id = (select auth.uid()))'),
      ('blocks', 'blocker_id = (select auth.uid())'),
      ('groups', 'owner_id = (select auth.uid())'),
      ('group_members', 'user_id = (select auth.uid())'),
      ('posts', 'author_id = (select auth.uid())'),
      ('post_media', 'author_id = (select auth.uid())'),
      ('post_likes', 'user_id = (select auth.uid())'),
      ('reports', 'reporter_id = (select auth.uid())'),
      ('social_notifications', 'user_id = (select auth.uid())')) as v(tbl, cond)
  loop
    execute format('alter table public.%I enable row level security', t.tbl);
    execute format('revoke all on public.%I from anon, authenticated', t.tbl);
    execute format('grant select on public.%I to authenticated', t.tbl);
    execute format('drop policy if exists %I on public.%I', t.tbl || '_owner_read', t.tbl);
    execute format('create policy %I on public.%I for select to authenticated using (%s and (select public.can_access()))',
                   t.tbl || '_owner_read', t.tbl, t.cond);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- C. Internal helpers (private schema; called only from definer code)
-- -----------------------------------------------------------------------------
-- Social-active: enabled, approved, onboarded, not blocked, stored birth year 18+ (year precision).
create or replace function private.social_active(p_user uuid)
returns boolean language sql stable set search_path = public set "TimeZone" = 'Europe/Istanbul' as $$
  select exists (
    select 1 from public.social_profiles s
      join public.profiles p on p.user_id = s.user_id
      join public.profile_private pp on pp.user_id = s.user_id
     where s.user_id = p_user and s.enabled
       and p.status = 'approved' and not p.is_blocked and p.onboarding_completed_at is not null
       and pp.birth_year is not null and pp.birth_year <= extract(year from current_date)::int - 18)
$$;

create or replace function private.blocked_either(a uuid, b uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.blocks
                  where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;

create or replace function private.follows_accepted(a uuid, b uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.follows where follower_id = a and followee_id = b and status = 'accepted')
$$;

-- The caller when signed in, approved and social-active; otherwise null (read RPCs then return nothing).
create or replace function private.social_viewer()
returns uuid language sql stable set search_path = public, private as $$
  select case when auth.uid() is not null and public.can_access() and private.social_active(auth.uid())
              then auth.uid() end
$$;

-- Same, but raising (write RPCs).
create or replace function private.social_me()
returns uuid language plpgsql stable set search_path = public, private as $$
declare
  v uuid := auth.uid();
begin
  if v is null or not public.can_access() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not private.social_active(v) then
    raise exception 'SOCIAL_DISABLED' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- Start of the app's calendar day (Europe/Istanbul) for the daily rate limits.
create or replace function private.social_today()
returns timestamptz language sql stable as $$
  select ((now() at time zone 'Europe/Istanbul')::date)::timestamp at time zone 'Europe/Istanbul'
$$;

create or replace function private.group_role(p_group uuid, p_user uuid)
returns text language sql stable set search_path = public as $$
  select role from public.group_members where group_id = p_group and user_id = p_user and status = 'active'
$$;

create or replace function private.new_invite_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  a constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32 symbols, no 0/O/1/I
  b bytea;
  c text;
begin
  loop
    b := extensions.gen_random_bytes(10);
    c := '';
    for i in 0..9 loop
      c := c || substr(a, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.groups where invite_code = c);
  end loop;
  return c;
end;
$$;

-- Payload validation per post kind.
create or replace function private.jkeys_ok(o jsonb, allowed text[], required text[])
returns boolean language sql immutable as $$
  select jsonb_typeof(o) = 'object'
     and not exists (select 1 from jsonb_object_keys(o) k where k <> all (allowed))
     and o ?& required
$$;
create or replace function private.jnum_ok(v jsonb)
returns boolean language sql immutable as $$
  select coalesce(jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between 0 and 1000000000, false)
$$;
create or replace function private.jstr_ok(v jsonb, maxlen integer)
returns boolean language sql immutable as $$
  select coalesce(jsonb_typeof(v) = 'string' and char_length(v #>> '{}') between 1 and maxlen, false)
$$;

create or replace function private.social_payload_valid(p_kind text, p jsonb)
returns boolean language plpgsql immutable set search_path = private as $$
declare
  e jsonb;
  d jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 16384 then
    return false;
  end if;
  if p_kind = 'workout' then
    if not private.jkeys_ok(p, array['date', 'duration_sec', 'volume_kg', 'sets', 'exercises'],
                               array['date', 'duration_sec', 'volume_kg', 'sets', 'exercises'])
       or not private.jstr_ok(p -> 'date', 10) or (p ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$'
       or not private.jnum_ok(p -> 'duration_sec') or not private.jnum_ok(p -> 'volume_kg')
       or not private.jnum_ok(p -> 'sets')
       or jsonb_typeof(p -> 'exercises') <> 'array' or jsonb_array_length(p -> 'exercises') > 60 then
      return false;
    end if;
    for e in select x from jsonb_array_elements(p -> 'exercises') x loop
      if not private.jkeys_ok(e, array['name', 'best'], array['name']) or not private.jstr_ok(e -> 'name', 120) then
        return false;
      end if;
    end loop;
    return true;
  elsif p_kind = 'program' then
    if not private.jkeys_ok(p, array['name', 'days'], array['name', 'days'])
       or not private.jstr_ok(p -> 'name', 120)
       or jsonb_typeof(p -> 'days') <> 'array' or jsonb_array_length(p -> 'days') not between 1 and 14 then
      return false;
    end if;
    for d in select x from jsonb_array_elements(p -> 'days') x loop
      if not private.jkeys_ok(d, array['name', 'exercises'], array['name', 'exercises'])
         or not private.jstr_ok(d -> 'name', 120)
         or jsonb_typeof(d -> 'exercises') <> 'array' or jsonb_array_length(d -> 'exercises') > 40 then
        return false;
      end if;
      for e in select x from jsonb_array_elements(d -> 'exercises') x loop
        if not private.jkeys_ok(e, array['name', 'exercise_id', 'sets', 'reps_low', 'reps_high'],
                                   array['name', 'sets', 'reps_low', 'reps_high'])
           or not private.jstr_ok(e -> 'name', 120)
           or not private.jnum_ok(e -> 'sets') or not private.jnum_ok(e -> 'reps_low') or not private.jnum_ok(e -> 'reps_high')
           or (e ? 'exercise_id' and jsonb_typeof(e -> 'exercise_id') <> 'null'
               and not private.jstr_ok(e -> 'exercise_id', 64) and not private.jnum_ok(e -> 'exercise_id')) then
          return false;
        end if;
      end loop;
    end loop;
    return true;
  elsif p_kind = 'meal' then
    return private.jkeys_ok(p, array['name', 'kcal', 'protein_g', 'carb_g', 'fat_g'], array['kcal', 'protein_g', 'carb_g', 'fat_g'])
       and (not p ? 'name' or private.jstr_ok(p -> 'name', 120))
       and private.jnum_ok(p -> 'kcal') and private.jnum_ok(p -> 'protein_g')
       and private.jnum_ok(p -> 'carb_g') and private.jnum_ok(p -> 'fat_g');
  elsif p_kind in ('text', 'photo', 'progress', 'compare') then
    return p = '{}'::jsonb;
  end if;
  return false;
end;
$$;

create or replace function private.check_audience(p_user uuid, p_audience text, p_group uuid)
returns void language plpgsql stable set search_path = public, private as $$
begin
  if p_audience is null or p_audience not in ('public', 'followers', 'friends', 'group')
     or (p_audience = 'group') <> (p_group is not null) then
    raise exception 'BAD_AUDIENCE' using errcode = '22023';
  end if;
  if p_group is not null and private.group_role(p_group, p_user) is null then
    raise exception 'NOT_GROUP_MEMBER' using errcode = 'P0001';
  end if;
end;
$$;

-- Ownership goes to the oldest active admin, else the oldest active member; an empty group is deleted.
create or replace function private.group_transfer_or_delete(p_group uuid, p_leaving uuid)
returns void language plpgsql set search_path = public, private as $$
declare
  v_new uuid;
begin
  select gm.user_id into v_new from public.group_members gm
   where gm.group_id = p_group and gm.user_id <> p_leaving and gm.status = 'active'
   order by private.social_active(gm.user_id) desc, (gm.role = 'admin') desc, gm.created_at, gm.user_id
   limit 1;
  if v_new is null then
    delete from public.groups where id = p_group;
    return;
  end if;
  delete from public.group_members where group_id = p_group and user_id = p_leaving;
  update public.group_members set role = 'owner' where group_id = p_group and user_id = v_new;
  update public.groups set owner_id = v_new where id = p_group;
end;
$$;

-- Leaving the social side. p_delete: erase posts (media -> storage_garbage), likes, follows, group
-- memberships (ownership transfers), notifications and own reports; otherwise only pause (hidden).
-- Blocks are kept on purpose (they protect both sides if the user comes back).
create or replace function private.social_wipe(p_user uuid, p_delete boolean, p_log boolean)
returns void language plpgsql set search_path = public, private, storage as $$
declare
  g record;
begin
  if p_delete then
    insert into private.storage_garbage (bucket, path)
    select o.bucket_id, o.name from storage.objects o
     where o.bucket_id = 'social-media' and o.name like p_user::text || '/%'
    on conflict do nothing;
    for g in select id from public.groups where owner_id = p_user loop
      perform private.group_transfer_or_delete(g.id, p_user);
    end loop;
    delete from public.group_members where user_id = p_user;
    delete from public.posts where author_id = p_user;
    delete from public.post_likes where user_id = p_user;
    delete from public.follows where follower_id = p_user or followee_id = p_user;
    delete from public.social_notifications where user_id = p_user or actor_id = p_user;
    delete from public.reports where reporter_id = p_user;
    update public.social_profiles
       set enabled = false, enabled_at = null, bio = null, is_private = true, discoverable = true
     where user_id = p_user;
  else
    update public.social_profiles set enabled = false where user_id = p_user;
  end if;
  if p_log then
    insert into public.user_consents (user_id, kind, version, granted)
    values (p_user, 'social',
            left(coalesce((select value #>> '{}' from public.app_config where key = 'social_consent_version'), 'unknown'), 20),
            false);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- D. Visibility (the only place that decides who sees what)
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
                                 and (g.visibility = 'open' or private.group_role(p.group_id, v.me) is not null)
               else false end)
      from public.posts p
      join public.social_profiles sp on sp.user_id = p.author_id
      left join public.groups g on g.id = p.group_id
      cross join (select auth.uid() as me) v
     where p.id = p_post and v.me is not null and public.can_access()), false)
$$;

-- Full profile (posts grid, follower lists): self, or both social-active, no block, and public or followed.
create or replace function public.can_view_profile(p_user uuid)
returns boolean language sql stable security definer set search_path = public, private as $$
  select coalesce(auth.uid() is not null and public.can_access() and (
    p_user = auth.uid() or (
      private.social_active(auth.uid()) and private.social_active(p_user)
      and not private.blocked_either(auth.uid(), p_user)
      and (not (select s.is_private from public.social_profiles s where s.user_id = p_user)
           or private.follows_accepted(auth.uid(), p_user)))), false)
$$;

-- Storage policy helpers (object names are parsed safely; a malformed name is simply false).
create or replace function public.social_media_readable(p_name text)
returns boolean language plpgsql stable security definer set search_path = public, private as $$
declare
  v_post uuid;
begin
  if p_name is null or p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$' then return false; end if;
  v_post := split_part(p_name, '/', 2)::uuid;
  return public.can_view_post(v_post)
      or (public.is_admin() and exists (select 1 from public.reports r
                                         where r.target_kind = 'post' and r.target_id = v_post and r.status = 'open'));
exception when invalid_text_representation then
  return false;
end;
$$;

-- Upload: own prefix <uid>/<post>/<uuid>.(jpg|webp), own post younger than 10 minutes, at most 4 objects.
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
           where o.bucket_id = 'social-media' and o.name like v::text || '/' || v_post::text || '/%') < 4;
end;
$$;

-- post_media insert: author, within 10 minutes of the post, path under the post's prefix, object uploaded.
create or replace function public.social_media_attach_ok(p_post uuid, p_path text)
returns boolean language plpgsql stable security definer set search_path = public, private, storage as $$
declare
  v uuid := auth.uid();
begin
  if v is null or p_post is null or p_path is null
     or p_path !~ ('^' || v::text || '/' || p_post::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|webp)$') then
    return false;
  end if;
  return public.can_access() and private.social_active(v)
     and exists (select 1 from public.posts p where p.id = p_post and p.author_id = v
                    and p.created_at > now() - interval '10 minutes')
     and exists (select 1 from storage.objects o where o.bucket_id = 'social-media' and o.name = p_path);
end;
$$;

revoke all on function public.can_view_post(uuid), public.can_view_profile(uuid), public.social_media_readable(text),
  public.social_media_upload_ok(text), public.social_media_attach_ok(uuid, text) from public, anon;
-- RLS / Storage policy helpers (policies run as the caller); they return a boolean about the caller only.
grant execute on function public.can_view_post(uuid), public.can_view_profile(uuid), public.social_media_readable(text),
  public.social_media_upload_ok(text), public.social_media_attach_ok(uuid, text) to authenticated;

grant insert on public.post_media to authenticated;
drop policy if exists "post_media_author_insert" on public.post_media;
create policy "post_media_author_insert" on public.post_media for insert to authenticated
  with check (author_id = (select auth.uid()) and (select public.can_access())
              and public.social_media_attach_ok(post_id, path));

-- -----------------------------------------------------------------------------
-- E. Triggers
-- -----------------------------------------------------------------------------
create or replace function public.social_likes_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_author uuid;
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id returning author_id into v_author;
    -- one like notification per post per hour
    if v_author is not null and v_author <> new.user_id
       and not exists (select 1 from public.social_notifications n
                        where n.user_id = v_author and n.kind = 'like' and n.post_id = new.post_id
                          and n.created_at > now() - interval '1 hour') then
      insert into public.social_notifications (user_id, kind, actor_id, post_id) values (v_author, 'like', new.user_id, new.post_id);
    end if;
  else
    update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;
drop trigger if exists post_likes_after on public.post_likes;
create trigger post_likes_after after insert or delete on public.post_likes
  for each row execute function public.social_likes_after();

create or replace function public.social_follows_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.social_notifications (user_id, kind, actor_id)
    values (new.followee_id, case when new.status = 'accepted' then 'follow' else 'follow_request' end, new.follower_id);
  elsif old.status = 'pending' and new.status = 'accepted' then
    insert into public.social_notifications (user_id, kind, actor_id) values (new.follower_id, 'follow_accepted', new.followee_id);
  end if;
  return null;
end;
$$;
drop trigger if exists follows_after on public.follows;
create trigger follows_after after insert or update of status on public.follows
  for each row execute function public.social_follows_after();

create or replace function public.social_group_members_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'invited' then
      insert into public.social_notifications (user_id, kind, actor_id, group_id)
      values (new.user_id, 'group_invite', coalesce(new.invited_by, auth.uid()), new.group_id);
    elsif new.status = 'pending' then
      insert into public.social_notifications (user_id, kind, actor_id, group_id)
      select gm.user_id, 'group_request', new.user_id, new.group_id
        from public.group_members gm
       where gm.group_id = new.group_id and gm.status = 'active' and gm.role in ('owner', 'admin');
    end if;
  elsif old.status = 'pending' and new.status = 'active' and auth.uid() is distinct from new.user_id then
    insert into public.social_notifications (user_id, kind, actor_id, group_id)
    values (new.user_id, 'group_accepted', auth.uid(), new.group_id);
  end if;
  return null;
end;
$$;
drop trigger if exists group_members_after on public.group_members;
create trigger group_members_after after insert or update of status on public.group_members
  for each row execute function public.social_group_members_after();

-- Media garbage: every deleted post_media row (direct, post cascade, social_disable, account deletion)
-- and every object left under a deleted post's prefix.
create or replace function public.social_media_garbage()
returns trigger language plpgsql security definer set search_path = public, private, storage as $$
begin
  if tg_table_name = 'post_media' then
    insert into private.storage_garbage (bucket, path) values ('social-media', old.path) on conflict do nothing;
  else
    insert into private.storage_garbage (bucket, path)
    select o.bucket_id, o.name from storage.objects o
     where o.bucket_id = 'social-media' and o.name like old.author_id::text || '/' || old.id::text || '/%'
    on conflict do nothing;
  end if;
  return null;
end;
$$;
drop trigger if exists post_media_garbage on public.post_media;
create trigger post_media_garbage after delete on public.post_media
  for each row execute function public.social_media_garbage();
drop trigger if exists posts_garbage on public.posts;
create trigger posts_garbage after delete on public.posts
  for each row execute function public.social_media_garbage();

-- A birth year under 18 closes the social side (same effect as social_disable(true)).
create or replace function public.social_age_guard()
returns trigger language plpgsql security definer set search_path = public, private set "TimeZone" = 'Europe/Istanbul' as $$
begin
  if new.birth_year is not null and new.birth_year > extract(year from current_date)::int - 18
     and exists (select 1 from public.social_profiles s
                  where s.user_id = new.user_id and (s.enabled or s.enabled_at is not null)) then
    perform private.social_wipe(new.user_id, true, true);
  end if;
  return null;
end;
$$;
drop trigger if exists profile_private_social_age on public.profile_private;
create trigger profile_private_social_age after insert or update of birth_year on public.profile_private
  for each row execute function public.social_age_guard();

-- Account deletion: run the social wipe first so group ownership transfers and media paths are queued.
create or replace function public.social_before_user_delete()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if exists (select 1 from public.social_profiles where user_id = old.id) then
    perform private.social_wipe(old.id, true, false);
  end if;
  return old;
end;
$$;
drop trigger if exists social_before_user_delete on auth.users;
create trigger social_before_user_delete before delete on auth.users
  for each row execute function public.social_before_user_delete();

revoke all on function public.social_likes_after(), public.social_follows_after(), public.social_group_members_after(),
  public.social_media_garbage(), public.social_age_guard(), public.social_before_user_delete() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- F. RPCs
-- -----------------------------------------------------------------------------
-- F1. Enable / disable / settings
create or replace function public.social_enable(p_consent_version text)
returns void language plpgsql security definer set search_path = public, private set "TimeZone" = 'Europe/Istanbul' as $$
declare
  v uuid := auth.uid();
  v_birth smallint;
begin
  if v is null or not public.has_onboarded() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_consent_version is distinct from (select value #>> '{}' from public.app_config where key = 'social_consent_version') then
    raise exception 'SOCIAL_CONSENT_VERSION' using errcode = '22023';
  end if;
  select birth_year into v_birth from public.profile_private where user_id = v;
  if v_birth is null then
    raise exception 'SOCIAL_BIRTH_YEAR_REQUIRED' using errcode = 'P0001';
  end if;
  if v_birth > extract(year from current_date)::int - 18 then
    raise exception 'SOCIAL_UNDERAGE' using errcode = 'P0001';
  end if;
  perform public.record_consent('social', p_consent_version);
  insert into public.social_profiles (user_id, enabled, enabled_at) values (v, true, now())
  on conflict (user_id) do update
    set enabled = true,
        enabled_at = case when public.social_profiles.enabled then public.social_profiles.enabled_at else now() end;
end;
$$;

create or replace function public.social_disable(p_delete boolean default true)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.social_profiles where user_id = v) then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('social:' || v::text, 0));
  perform private.social_wipe(v, coalesce(p_delete, true), true);
end;
$$;

-- null = unchanged; p_bio '' clears. Going public accepts every pending request.
create or replace function public.social_update_settings(p_is_private boolean default null,
  p_discoverable boolean default null, p_bio text default null)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
  v_was_private boolean;
  v_bio text := nullif(btrim(p_bio), '');
begin
  if v_bio is not null and char_length(v_bio) > 160 then
    raise exception 'BAD_BIO' using errcode = '22023';
  end if;
  select is_private into v_was_private from public.social_profiles where user_id = v for update;
  update public.social_profiles
     set is_private = coalesce(p_is_private, is_private),
         discoverable = coalesce(p_discoverable, discoverable),
         bio = case when p_bio is null then bio else v_bio end
   where user_id = v;
  if v_was_private and p_is_private is false then
    update public.follows set status = 'accepted', accepted_at = now()
     where followee_id = v and status = 'pending';
  end if;
end;
$$;

-- F2. Follows
create or replace function public.social_follow(p_user uuid)
returns text language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
  v_status text;
begin
  if p_user is null or p_user = v or not private.social_active(p_user) or private.blocked_either(v, p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select status into v_status from public.follows where follower_id = v and followee_id = p_user;
  if found then return v_status; end if;
  perform pg_advisory_xact_lock(hashtextextended('social:' || v::text, 0));
  if greatest(
       (select count(*) from public.follows where follower_id = v and created_at >= private.social_today()),
       (select count(*) from public.social_notifications
         where actor_id = v and kind in ('follow', 'follow_request') and created_at >= private.social_today())) >= 50 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  v_status := case when (select is_private from public.social_profiles where user_id = p_user) then 'pending' else 'accepted' end;
  insert into public.follows (follower_id, followee_id, status, accepted_at)
  values (v, p_user, v_status, case when v_status = 'accepted' then now() end);
  return v_status;
end;
$$;

create or replace function public.social_respond_follow(p_follower uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
begin
  if not exists (select 1 from public.follows where follower_id = p_follower and followee_id = v and status = 'pending') then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_accept then
    update public.follows set status = 'accepted', accepted_at = now() where follower_id = p_follower and followee_id = v;
  else
    delete from public.follows where follower_id = p_follower and followee_id = v;
  end if;
end;
$$;

create or replace function public.social_unfollow(p_user uuid)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null or not public.can_access() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.follows where follower_id = auth.uid() and followee_id = p_user;
end;
$$;

create or replace function public.social_remove_follower(p_user uuid)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null or not public.can_access() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.follows where follower_id = p_user and followee_id = auth.uid();
end;
$$;

create or replace function public.social_follow_requests()
returns table (user_id uuid, username text, display_name text, avatar_path text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, private as $$
#variable_conflict use_column
declare
  v uuid := private.social_viewer();
begin
  if v is null then return; end if;
  return query
    select p.user_id, p.username::text, p.display_name, p.avatar_path, f.created_at
      from public.follows f join public.profiles p on p.user_id = f.follower_id
     where f.followee_id = v and f.status = 'pending'
       and private.social_active(f.follower_id) and not private.blocked_either(v, f.follower_id)
     order by f.created_at desc
     limit 500;
end;
$$;

-- F3. Blocks (always allowed for approved users)
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
end;
$$;

create or replace function public.social_unblock(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_access() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_user;
end;
$$;

create or replace function public.social_blocked_users()
returns table (user_id uuid, username text, display_name text, avatar_path text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.can_access() then return; end if;
  return query
    select p.user_id, p.username::text, p.display_name, p.avatar_path, b.created_at
      from public.blocks b join public.profiles p on p.user_id = b.blocked_id
     where b.blocker_id = auth.uid()
     order by b.created_at desc;
end;
$$;

-- F4. Posts and likes
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
  if (select count(*) from public.posts where author_id = v and created_at >= private.social_today()) >= 20 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  insert into public.posts (author_id, kind, body, payload, audience, group_id)
  values (v, p_kind, v_body, v_payload, p_audience, p_group)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.social_delete_post(p_post uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  delete from public.posts where id = p_post and author_id = auth.uid();
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
end;
$$;

create or replace function public.social_set_audience(p_post uuid, p_audience text, p_group uuid default null)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
begin
  if not exists (select 1 from public.posts where id = p_post and author_id = v) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform private.check_audience(v, p_audience, p_group);
  update public.posts set audience = p_audience, group_id = p_group where id = p_post;
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
    if (select count(*) from public.post_likes where user_id = v and created_at >= private.social_today()) >= 200 then
      raise exception 'RATE_LIMITED' using errcode = 'P0001';
    end if;
    insert into public.post_likes (post_id, user_id) values (p_post, v);
  end if;
  return (select like_count from public.posts where id = p_post);
end;
$$;

create or replace function public.social_unlike(p_post uuid)
returns integer language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_access() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.post_likes where post_id = p_post and user_id = auth.uid();
  return coalesce((select like_count from public.posts where id = p_post and public.can_view_post(id)), 0);
end;
$$;

-- F5. Reads. Every post list returns public.social_post_item rows (newest first, keyset on created_at).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'social_post_item' and typnamespace = 'public'::regnamespace) then
    create type public.social_post_item as (
      id uuid, author_id uuid, author_username text, author_display_name text, author_avatar_path text,
      kind text, body text, payload jsonb, audience text, group_id uuid, group_name text,
      like_count integer, liked_by_me boolean, media jsonb, created_at timestamptz);
  end if;
end;
$$;

create or replace function private.render_posts(p_viewer uuid, p_ids uuid[])
returns setof public.social_post_item language sql stable set search_path = public as $$
  select p.id, p.author_id, pr.username::text, pr.display_name, pr.avatar_path,
         p.kind, p.body, p.payload, p.audience, p.group_id, g.name,
         p.like_count,
         exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = p_viewer),
         coalesce((select jsonb_agg(jsonb_build_object('path', m.path, 'width', m.width, 'height', m.height,
                                                       'position', m.position) order by m.position)
                     from public.post_media m where m.post_id = p.id), '[]'::jsonb),
         p.created_at
    from public.posts p
    join public.profiles pr on pr.user_id = p.author_id
    left join public.groups g on g.id = p.group_id
   where p.id = any (p_ids)
   order by p.created_at desc, p.id desc
$$;

create or replace function public.social_feed(p_before timestamptz default null, p_limit integer default 20)
returns setof public.social_post_item language plpgsql stable security definer set search_path = public, private as $$
declare
  v uuid := private.social_viewer();
begin
  if v is null then return; end if;
  return query select * from private.render_posts(v, array(
    select p.id from public.posts p
     where p.created_at < coalesce(p_before, 'infinity'::timestamptz)
       and (p.author_id = v
            or p.author_id in (select f.followee_id from public.follows f where f.follower_id = v and f.status = 'accepted')
            or p.group_id in (select gm.group_id from public.group_members gm where gm.user_id = v and gm.status = 'active'))
       and public.can_view_post(p.id)
     order by p.created_at desc, p.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)));
end;
$$;

create or replace function public.social_discover(p_before timestamptz default null, p_limit integer default 20)
returns setof public.social_post_item language plpgsql stable security definer set search_path = public, private as $$
declare
  v uuid := private.social_viewer();
begin
  if v is null then return; end if;
  return query select * from private.render_posts(v, array(
    select p.id from public.posts p
      join public.social_profiles s on s.user_id = p.author_id
     where p.audience = 'public' and not s.is_private and s.discoverable
       and p.created_at < coalesce(p_before, 'infinity'::timestamptz)
       and public.can_view_post(p.id)
     order by p.created_at desc, p.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)));
end;
$$;

create or replace function public.social_user_posts(p_user uuid, p_before timestamptz default null, p_limit integer default 20)
returns setof public.social_post_item language plpgsql stable security definer set search_path = public, private as $$
declare
  v uuid := private.social_viewer();
begin
  if v is null then return; end if;
  return query select * from private.render_posts(v, array(
    select p.id from public.posts p
     where p.author_id = p_user and p.created_at < coalesce(p_before, 'infinity'::timestamptz)
       and public.can_view_post(p.id)
     order by p.created_at desc, p.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)));
end;
$$;

create or replace function public.social_group_posts(p_group uuid, p_before timestamptz default null, p_limit integer default 20)
returns setof public.social_post_item language plpgsql stable security definer set search_path = public, private as $$
declare
  v uuid := private.social_viewer();
begin
  if v is null then return; end if;
  return query select * from private.render_posts(v, array(
    select p.id from public.posts p
     where p.group_id = p_group and p.created_at < coalesce(p_before, 'infinity'::timestamptz)
       and public.can_view_post(p.id)
     order by p.created_at desc, p.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)));
end;
$$;

create or replace function public.social_post(p_post uuid)
returns setof public.social_post_item language plpgsql stable security definer set search_path = public, private as $$
declare
  v uuid := private.social_viewer();
begin
  if v is null or not public.can_view_post(p_post) then return; end if;
  return query select * from private.render_posts(v, array[p_post]);
end;
$$;

-- Header for any reachable user (both social-active, no block); can_view says whether posts/lists are open.
create or replace function public.social_profile(p_user uuid)
returns table (user_id uuid, username text, display_name text, avatar_path text, bio text, level integer,
  badges text[], followers_count integer, following_count integer, posts_count integer, is_private boolean,
  relation text, follows_me boolean, incoming_request boolean, can_view boolean)
language plpgsql stable security definer set search_path = public, private as $$
#variable_conflict use_column
declare
  v uuid := private.social_viewer();
begin
  if v is null or p_user is null then return; end if;
  if p_user <> v and (not private.social_active(p_user) or private.blocked_either(v, p_user)) then return; end if;
  return query
    select p.user_id, p.username::text, p.display_name, p.avatar_path, s.bio, p.level,
           coalesce((select array_agg(b.badge_code order by b.earned_at desc) from public.user_badges b
                      where b.user_id = p_user), '{}'::text[]),
           (select count(*)::int from public.follows f
             where f.followee_id = p_user and f.status = 'accepted' and private.social_active(f.follower_id)),
           (select count(*)::int from public.follows f
             where f.follower_id = p_user and f.status = 'accepted' and private.social_active(f.followee_id)),
           (select count(*)::int from public.posts x where x.author_id = p_user),
           s.is_private,
           case when p_user = v then 'self'
                when fo.status = 'accepted' and private.follows_accepted(p_user, v) then 'friends'
                when fo.status = 'accepted' then 'following'
                when fo.status = 'pending' then 'requested'
                else 'none' end,
           private.follows_accepted(p_user, v),
           exists (select 1 from public.follows r where r.follower_id = p_user and r.followee_id = v and r.status = 'pending'),
           public.can_view_profile(p_user)
      from public.profiles p
      join public.social_profiles s on s.user_id = p.user_id
      left join public.follows fo on fo.follower_id = v and fo.followee_id = p_user
     where p.user_id = p_user;
end;
$$;

create or replace function public.social_search_users(p_query text)
returns table (user_id uuid, username text, display_name text, avatar_path text, is_private boolean, relation text)
language plpgsql stable security definer set search_path = public, private as $$
#variable_conflict use_column
declare
  v uuid := private.social_viewer();
  q text := btrim(coalesce(p_query, ''));
  pat text;
begin
  if v is null or char_length(q) < 2 or char_length(q) > 60 then return; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select p.user_id, p.username::text, p.display_name, p.avatar_path, s.is_private,
           case when fo.status = 'accepted' and private.follows_accepted(p.user_id, v) then 'friends'
                when fo.status = 'accepted' then 'following'
                when fo.status = 'pending' then 'requested'
                else 'none' end
      from public.social_profiles s
      join public.profiles p on p.user_id = s.user_id
      left join public.follows fo on fo.follower_id = v and fo.followee_id = s.user_id
     where s.enabled and s.discoverable and s.user_id <> v
       and (p.username::text ilike pat or p.display_name ilike pat)
       and private.social_active(s.user_id) and not private.blocked_either(v, s.user_id)
     order by (p.username::text ilike q || '%') desc, p.username
     limit 20;
end;
$$;

create or replace function public.social_followers(p_user uuid)
returns table (user_id uuid, username text, display_name text, avatar_path text, since timestamptz)
language plpgsql stable security definer set search_path = public, private as $$
#variable_conflict use_column
declare
  v uuid := private.social_viewer();
begin
  if v is null or p_user is null or not public.can_view_profile(p_user) then return; end if;
  return query
    select p.user_id, p.username::text, p.display_name, p.avatar_path, f.accepted_at
      from public.follows f join public.profiles p on p.user_id = f.follower_id
     where f.followee_id = p_user and f.status = 'accepted'
       and private.social_active(f.follower_id) and not private.blocked_either(v, f.follower_id)
     order by f.accepted_at desc nulls last
     limit 1000;
end;
$$;

create or replace function public.social_following(p_user uuid)
returns table (user_id uuid, username text, display_name text, avatar_path text, since timestamptz)
language plpgsql stable security definer set search_path = public, private as $$
#variable_conflict use_column
declare
  v uuid := private.social_viewer();
begin
  if v is null or p_user is null or not public.can_view_profile(p_user) then return; end if;
  return query
    select p.user_id, p.username::text, p.display_name, p.avatar_path, f.accepted_at
      from public.follows f join public.profiles p on p.user_id = f.followee_id
     where f.follower_id = p_user and f.status = 'accepted'
       and private.social_active(f.followee_id) and not private.blocked_either(v, f.followee_id)
     order by f.accepted_at desc nulls last
     limit 1000;
end;
$$;

-- F6. Notifications
create or replace function public.social_notifications_list(p_before timestamptz default null, p_limit integer default 30)
returns table (id uuid, kind text, actor_id uuid, actor_username text, actor_display_name text, actor_avatar_path text,
  post_id uuid, group_id uuid, group_name text, created_at timestamptz, read_at timestamptz)
language plpgsql stable security definer set search_path = public, private as $$
#variable_conflict use_column
declare
  v uuid := private.social_viewer();
begin
  if v is null then return; end if;
  return query
    select n.id, n.kind, n.actor_id, p.username::text, p.display_name, p.avatar_path,
           n.post_id, n.group_id, g.name, n.created_at, n.read_at
      from public.social_notifications n
      left join public.profiles p on p.user_id = n.actor_id
      left join public.groups g on g.id = n.group_id
     where n.user_id = v and n.created_at < coalesce(p_before, 'infinity'::timestamptz)
       and (n.actor_id is null or (private.social_active(n.actor_id) and not private.blocked_either(v, n.actor_id)))
       and (n.kind <> 'follow_request'
            or exists (select 1 from public.follows f where f.follower_id = n.actor_id and f.followee_id = v and f.status = 'pending'))
     order by n.created_at desc, n.id desc
     limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

create or replace function public.social_unread_count()
returns integer language sql stable security definer set search_path = public, private as $$
  select coalesce((select count(*)::int from public.social_notifications n
                    where n.user_id = private.social_viewer() and n.read_at is null
                      and (n.actor_id is null or (private.social_active(n.actor_id)
                                                  and not private.blocked_either(n.user_id, n.actor_id)))), 0)
$$;

-- null = all
create or replace function public.social_mark_read(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if auth.uid() is null or not public.can_access() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.social_notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- F7. Groups
create or replace function private.group_assert_capacity(p_group uuid)
returns void language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('group:' || p_group::text, 0));
  if (select count(*) from public.group_members where group_id = p_group and status = 'active') >= 200 then
    raise exception 'GROUP_FULL' using errcode = 'P0001';
  end if;
end;
$$;

-- Group visible to the caller at all (exists, owner not blocked either way).
create or replace function private.group_visible(p_group uuid, p_user uuid)
returns boolean language sql stable set search_path = public, private as $$
  select exists (select 1 from public.groups g where g.id = p_group and not private.blocked_either(p_user, g.owner_id))
$$;

create or replace function public.group_create(p_name text, p_description text default null, p_visibility text default 'open')
returns uuid language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_id uuid;
begin
  if char_length(v_name) not between 3 and 60 then raise exception 'BAD_NAME' using errcode = '22023'; end if;
  if v_desc is not null and char_length(v_desc) > 300 then raise exception 'BAD_DESCRIPTION' using errcode = '22023'; end if;
  if p_visibility is null or p_visibility not in ('open', 'closed') then raise exception 'BAD_VISIBILITY' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('social:' || v::text, 0));
  if (select count(*) from public.groups where owner_id = v) >= 20 then
    raise exception 'GROUP_LIMIT' using errcode = 'P0001';
  end if;
  insert into public.groups (owner_id, name, description, visibility, invite_code)
  values (v, v_name, v_desc, p_visibility, private.new_invite_code())
  returning id into v_id;
  insert into public.group_members (group_id, user_id, role, status) values (v_id, v, 'owner', 'active');
  return v_id;
end;
$$;

-- null = unchanged; '' clears the description. Opening a closed group accepts pending requests (up to the cap).
create or replace function public.group_update(p_group uuid, p_name text default null, p_description text default null,
  p_visibility text default null)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
  v_name text := btrim(p_name);
  v_old text;
begin
  if coalesce(private.group_role(p_group, v), '') not in ('owner', 'admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_name is not null and char_length(v_name) not between 3 and 60 then raise exception 'BAD_NAME' using errcode = '22023'; end if;
  if p_description is not null and char_length(btrim(p_description)) > 300 then raise exception 'BAD_DESCRIPTION' using errcode = '22023'; end if;
  if p_visibility is not null and p_visibility not in ('open', 'closed') then raise exception 'BAD_VISIBILITY' using errcode = '22023'; end if;
  select visibility into v_old from public.groups where id = p_group for update;
  update public.groups
     set name = coalesce(v_name, name),
         description = case when p_description is null then description else nullif(btrim(p_description), '') end,
         visibility = coalesce(p_visibility, visibility)
   where id = p_group;
  if v_old = 'closed' and p_visibility = 'open' then
    perform pg_advisory_xact_lock(hashtextextended('group:' || p_group::text, 0));
    update public.group_members gm set status = 'active'
     where gm.group_id = p_group and gm.status = 'pending'
       and gm.user_id in (select x.user_id from public.group_members x
                           where x.group_id = p_group and x.status = 'pending'
                           order by x.created_at
                           limit greatest(200 - (select count(*) from public.group_members a
                                                  where a.group_id = p_group and a.status = 'active'), 0));
  end if;
end;
$$;

-- open -> 'active'; closed -> 'pending' (request); an open invitation is accepted.
create or replace function public.group_join(p_group uuid)
returns text language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
  v_vis text;
  v_status text;
begin
  select g.visibility into v_vis from public.groups g where g.id = p_group and private.group_visible(p_group, v);
  if v_vis is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
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

create or replace function public.group_join_by_code(p_code text)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
  v_group uuid;
begin
  select g.id into v_group from public.groups g where g.invite_code = upper(btrim(coalesce(p_code, '')));
  if v_group is null or not private.group_visible(v_group, v) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
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

-- p_user null (or me): answer my invitation. Otherwise owner/admin answers p_user's join request.
create or replace function public.group_respond(p_group uuid, p_accept boolean, p_user uuid default null)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
  v_target uuid := coalesce(p_user, v);
  v_need text := case when coalesce(p_user, v) = v then 'invited' else 'pending' end;
begin
  if v_target <> v and coalesce(private.group_role(p_group, v), '') not in ('owner', 'admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = v_target and status = v_need) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_accept then
    perform private.group_assert_capacity(p_group);
    update public.group_members set status = 'active' where group_id = p_group and user_id = v_target;
  else
    delete from public.group_members where group_id = p_group and user_id = v_target;
  end if;
end;
$$;

-- Owner only. 'owner' transfers ownership (the old owner becomes admin).
create or replace function public.group_set_role(p_group uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
begin
  if private.group_role(p_group, v) is distinct from 'owner' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner', 'admin', 'member') then raise exception 'BAD_ROLE' using errcode = '22023'; end if;
  if p_user is null or p_user = v or private.group_role(p_group, p_user) is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_role = 'owner' then
    update public.group_members set role = 'admin' where group_id = p_group and user_id = v;
    update public.group_members set role = 'owner' where group_id = p_group and user_id = p_user;
    update public.groups set owner_id = p_user where id = p_group;
  else
    update public.group_members set role = p_role where group_id = p_group and user_id = p_user;
  end if;
end;
$$;

-- Owner/admin removes a member, request or invitation; only the owner removes admins; nobody removes the owner.
create or replace function public.group_remove_member(p_group uuid, p_user uuid)
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
end;
$$;

-- Also cancels an own request or declines an invitation.
create or replace function public.group_leave(p_group uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := auth.uid();
begin
  if v is null or not public.can_access() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if private.group_role(p_group, v) = 'owner' then
    perform pg_advisory_xact_lock(hashtextextended('group:' || p_group::text, 0));
    perform private.group_transfer_or_delete(p_group, v);
  else
    delete from public.group_members where group_id = p_group and user_id = v;
  end if;
end;
$$;

create or replace function public.group_rotate_code(p_group uuid)
returns text language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
  v_code text;
begin
  if coalesce(private.group_role(p_group, v), '') not in ('owner', 'admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  v_code := private.new_invite_code();
  update public.groups set invite_code = v_code where id = p_group;
  return v_code;
end;
$$;

create or replace function public.group_delete(p_group uuid)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null or not public.can_access() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.groups where id = p_group and owner_id = auth.uid();
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
end;
$$;

create or replace function public.social_my_groups()
returns table (group_id uuid, name text, description text, visibility text, owner_id uuid, role text, status text,
  member_count integer, invite_code text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, private as $$
#variable_conflict use_column
declare
  v uuid := private.social_viewer();
begin
  if v is null then return; end if;
  return query
    select g.id, g.name, g.description, g.visibility, g.owner_id, gm.role, gm.status,
           (select count(*)::int from public.group_members c where c.group_id = g.id and c.status = 'active'),
           case when gm.status = 'active' and gm.role in ('owner', 'admin') then g.invite_code end,
           g.created_at
      from public.group_members gm join public.groups g on g.id = gm.group_id
     where gm.user_id = v and not private.blocked_either(v, g.owner_id)
     order by gm.status, g.name;
end;
$$;

-- Closed groups show only their name to non-members (no description, members or posts).
create or replace function public.social_group(p_group uuid)
returns table (group_id uuid, name text, description text, visibility text, owner_id uuid, member_count integer,
  my_role text, my_status text, invite_code text, can_view_posts boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public, private as $$
#variable_conflict use_column
declare
  v uuid := private.social_viewer();
begin
  if v is null or not private.group_visible(p_group, v) then return; end if;
  return query
    select g.id, g.name,
           case when g.visibility = 'open' or gm.status in ('active', 'invited') then g.description end,
           g.visibility,
           case when g.visibility = 'open' or gm.status = 'active' then g.owner_id end,
           case when g.visibility = 'open' or gm.status = 'active' then
             (select count(*)::int from public.group_members c where c.group_id = g.id and c.status = 'active') end,
           case when gm.status = 'active' then gm.role end,
           gm.status,
           case when gm.status = 'active' and gm.role in ('owner', 'admin') then g.invite_code end,
           (g.visibility = 'open' or gm.status = 'active'),
           g.created_at
      from public.groups g
      left join public.group_members gm on gm.group_id = g.id and gm.user_id = v
     where g.id = p_group;
end;
$$;

create or replace function public.social_search_groups(p_query text)
returns table (group_id uuid, name text, description text, visibility text, member_count integer, my_status text)
language plpgsql stable security definer set search_path = public, private as $$
#variable_conflict use_column
declare
  v uuid := private.social_viewer();
  q text := btrim(coalesce(p_query, ''));
  pat text;
begin
  if v is null or char_length(q) < 2 or char_length(q) > 60 then return; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select g.id, g.name,
           case when g.visibility = 'open' or gm.status = 'active' then g.description end,
           g.visibility,
           case when g.visibility = 'open' or gm.status = 'active' then
             (select count(*)::int from public.group_members c where c.group_id = g.id and c.status = 'active') end,
           gm.status
      from public.groups g
      left join public.group_members gm on gm.group_id = g.id and gm.user_id = v
     where g.name ilike pat and not private.blocked_either(v, g.owner_id)
     order by (g.name ilike q || '%') desc, g.name
     limit 20;
end;
$$;

-- Active members for members / open groups; owners and admins also see requests and invitations.
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
  if not exists (select 1 from public.groups g
                  where g.id = p_group and not private.blocked_either(v, g.owner_id)
                    and (g.visibility = 'open' or v_role is not null)) then
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

-- F8. Reports and moderation
create or replace function public.social_report(p_kind text, p_target uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v is null or not public.can_access() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('post', 'user', 'group') or p_target is null then
    raise exception 'BAD_TARGET' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 300 then raise exception 'BAD_REASON' using errcode = '22023'; end if;
  if (p_kind = 'post' and not public.can_view_post(p_target))
     or (p_kind = 'user' and not exists (select 1 from public.social_profiles where user_id = p_target))
     or (p_kind = 'group' and not exists (select 1 from public.groups where id = p_target)) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('social:' || v::text, 0));
  if (select count(*) from public.reports where reporter_id = v and created_at >= private.social_today()) >= 20 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  insert into public.reports (reporter_id, target_kind, target_id, reason) values (v, p_kind, p_target, v_reason)
  on conflict (reporter_id, target_kind, target_id) where status = 'open' do nothing;
end;
$$;

create or replace function public.admin_list_reports(p_status text default 'open')
returns table (id uuid, reporter_id uuid, reporter_username text, target_kind text, target_id uuid, reason text,
  status text, created_at timestamptz, resolved_at timestamptz, target jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
    select r.id, r.reporter_id, rp.username::text, r.target_kind, r.target_id, r.reason, r.status, r.created_at, r.resolved_at,
           case r.target_kind
             when 'post' then (
               select jsonb_build_object('author_id', p.author_id, 'author_username', pr.username, 'kind', p.kind,
                        'body', p.body, 'payload', p.payload, 'audience', p.audience, 'created_at', p.created_at,
                        'media', coalesce((select jsonb_agg(m.path order by m.position) from public.post_media m
                                            where m.post_id = p.id), '[]'::jsonb))
                 from public.posts p join public.profiles pr on pr.user_id = p.author_id where p.id = r.target_id)
             when 'user' then (
               select jsonb_build_object('username', pr.username, 'display_name', pr.display_name,
                        'avatar_path', pr.avatar_path, 'bio', s.bio)
                 from public.profiles pr left join public.social_profiles s on s.user_id = pr.user_id
                where pr.user_id = r.target_id)
             else (
               select jsonb_build_object('name', g.name, 'description', g.description, 'visibility', g.visibility,
                        'owner_id', g.owner_id)
                 from public.groups g where g.id = r.target_id)
           end
      from public.reports r
      left join public.profiles rp on rp.user_id = r.reporter_id
     where r.status = coalesce(p_status, 'open')
     order by r.created_at
     limit 200;
end;
$$;

create or replace function public.admin_resolve_report(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.reports set status = 'resolved', resolved_at = now(), resolved_by = auth.uid()
   where id = p_id and status = 'open';
end;
$$;

create or replace function public.admin_remove_post(p_post uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.posts where id = p_post;
  update public.reports set status = 'resolved', resolved_at = now(), resolved_by = auth.uid()
   where target_kind = 'post' and target_id = p_post and status = 'open';
end;
$$;

-- -----------------------------------------------------------------------------
-- G. Storage bucket (private, 600 KB, JPEG/WebP; path <author>/<post>/<uuid>.(jpg|webp))
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-media', 'social-media', false, 614400, array['image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "social_media_read" on storage.objects;
create policy "social_media_read" on storage.objects for select to authenticated
  using (bucket_id = 'social-media' and public.social_media_readable(name));
drop policy if exists "social_media_owner_insert" on storage.objects;
create policy "social_media_owner_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'social-media'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and public.social_media_upload_ok(name));
drop policy if exists "social_media_owner_delete" on storage.objects;
create policy "social_media_owner_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'social-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- -----------------------------------------------------------------------------
-- H. dispatch_reminders (20261120000000) + social notifications
-- -----------------------------------------------------------------------------
create or replace function public.dispatch_reminders()
returns integer language plpgsql security definer set search_path = public, private set "TimeZone" = 'Europe/Istanbul' as $$
declare
  v_url text;
  v_secret text;
  v_local timestamp := now() at time zone 'Europe/Istanbul';
  v_day date := v_local::date;
  v_to time := v_local::time;
  v_from time := case when v_local::time < time '00:05' then time '00:00' else v_local::time - interval '5 minutes' end;
  v_users jsonb;
  v_social jsonb;
  v_batch record;
  v_count integer := 0;
begin
  select c.function_url, c.secret into v_url, v_secret from private.push_config c where c.id;
  if v_url is null or v_secret is null then
    return 0;
  end if;

  delete from private.reminder_log where day < v_day - 7;

  with due as (
    select d.user_id, d.ref, d.label, d.remind_at
      from private.reminders_due(v_day, v_from, v_to) d
     where exists (select 1 from public.push_subscriptions s where s.user_id = d.user_id)
       and exists (select 1 from public.profiles p
                    where p.user_id = d.user_id and p.status = 'approved' and not p.is_blocked)
  ), fresh as (
    insert into private.reminder_log (user_id, ref, day)
    select due.user_id, due.ref, v_day from due
    on conflict do nothing
    returning reminder_log.user_id, reminder_log.ref
  ), per_user as (
    select due.user_id, array_agg(due.label order by due.remind_at, due.label, due.ref) as labels
      from due join fresh on fresh.user_id = due.user_id and fresh.ref = due.ref
     group by due.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', u.user_id,
           'payload', jsonb_build_object(
             'body', array_to_string(u.labels[1:3], ', ')
                     || case when cardinality(u.labels) > 3 then ' +' || (cardinality(u.labels) - 3)::text else '' end,
             'url', '/track',
             'tag', 'reminders-' || v_day::text))), '[]'::jsonb)
    into v_users
    from per_user u;

  -- Social: unread, unpushed notifications of the last day, collapsed to one "N new notifications" push,
  -- at most one per user per 10 minutes, only with social_push on and a device.
  with cand as (
    select n.user_id, count(*)::int as n
      from public.social_notifications n
     where n.pushed_at is null and n.read_at is null and n.created_at > now() - interval '1 day'
     group by n.user_id
  ), eligible as (
    select c.user_id, c.n, us.locale
      from cand c
      join public.user_settings us on us.user_id = c.user_id and us.social_push
     where private.social_active(c.user_id)
       and exists (select 1 from public.push_subscriptions s where s.user_id = c.user_id)
       and not exists (select 1 from public.social_notifications r
                        where r.user_id = c.user_id and r.pushed_at > now() - interval '10 minutes')
  ), marked as (
    update public.social_notifications n set pushed_at = now()
      from eligible e
     where n.user_id = e.user_id and n.pushed_at is null and n.read_at is null
       and n.created_at > now() - interval '1 day'
    returning n.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', e.user_id,
           'payload', jsonb_build_object(
             'body', case when e.locale = 'en'
                          then e.n::text || case when e.n = 1 then ' new notification' else ' new notifications' end
                          else e.n::text || ' yeni bildirim' end,
             'url', '/social',
             'tag', 'social'))), '[]'::jsonb)
    into v_social
    from eligible e;

  v_users := v_users || v_social;
  if jsonb_array_length(v_users) = 0 then
    return 0;
  end if;

  for v_batch in
    select jsonb_agg(m.msg order by m.rn) as msgs, count(*)::int as n
      from (select row_number() over (order by u.user_id, u.payload ->> 'tag', s.created_at, s.id) - 1 as rn,
                   jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'payload', u.payload) as msg
              from jsonb_to_recordset(v_users) as u(user_id uuid, payload jsonb)
              join public.push_subscriptions s on s.user_id = u.user_id) m
     group by m.rn / 100
     order by m.rn / 100
  loop
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('messages', v_batch.msgs),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret),
      timeout_milliseconds := 30000
    );
    v_count := v_count + v_batch.n;
  end loop;

  if v_count > 0 then
    insert into private.push_monthly (month, sent) values (date_trunc('month', v_day)::date, v_count)
    on conflict (month) do update set sent = private.push_monthly.sent + excluded.sent;
  end if;

  update public.push_subscriptions s set last_used_at = now()
   where s.user_id in (select (e ->> 'user_id')::uuid from jsonb_array_elements(v_users) e);

  return v_count;
end;
$$;
revoke all on function public.dispatch_reminders() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- I. Retention and Storage garbage
-- -----------------------------------------------------------------------------
-- Notifications 60 days, resolved reports 30 days, media posts whose upload never finished (hidden) 1 hour.
create or replace function private.social_retention()
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  n_notif integer; n_reports integer; n_posts integer;
begin
  delete from public.social_notifications where created_at < now() - interval '60 days';
  get diagnostics n_notif = row_count;
  delete from public.reports where status = 'resolved' and coalesce(resolved_at, created_at) < now() - interval '30 days';
  get diagnostics n_reports = row_count;
  delete from public.posts p
   where p.kind in ('photo', 'progress', 'compare') and p.created_at < now() - interval '1 hour'
     and not exists (select 1 from public.post_media m where m.post_id = p.id);
  get diagnostics n_posts = row_count;
  return jsonb_build_object('social_notifications', n_notif, 'reports', n_reports, 'empty_media_posts', n_posts);
end;
$$;
select cron.schedule('social-retention', '40 1 * * *', 'select private.social_retention()');

-- A worker with the service role removes the returned objects through the Storage API.
create or replace function public.ops_claim_storage_garbage(p_limit integer default 100)
returns table (bucket text, path text)
language plpgsql security definer set search_path = public, private as $$
#variable_conflict use_column
begin
  return query
    with c as (
      select g.bucket, g.path from private.storage_garbage g
       order by g.created_at
       limit least(greatest(coalesce(p_limit, 100), 1), 1000)
       for update skip locked
    )
    delete from private.storage_garbage g using c
     where g.bucket = c.bucket and g.path = c.path
    returning g.bucket, g.path;
end;
$$;
revoke all on function public.ops_claim_storage_garbage(integer) from public, anon, authenticated;
grant execute on function public.ops_claim_storage_garbage(integer) to service_role;

-- -----------------------------------------------------------------------------
-- J. Grants
-- -----------------------------------------------------------------------------
revoke all on function
  private.social_active(uuid), private.blocked_either(uuid, uuid), private.follows_accepted(uuid, uuid),
  private.social_viewer(), private.social_me(), private.social_today(), private.group_role(uuid, uuid),
  private.new_invite_code(), private.jkeys_ok(jsonb, text[], text[]), private.jnum_ok(jsonb), private.jstr_ok(jsonb, integer),
  private.social_payload_valid(text, jsonb), private.check_audience(uuid, text, uuid),
  private.group_transfer_or_delete(uuid, uuid), private.social_wipe(uuid, boolean, boolean),
  private.render_posts(uuid, uuid[]), private.group_assert_capacity(uuid), private.group_visible(uuid, uuid),
  private.social_retention()
from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.social_enable(text)', 'public.social_disable(boolean)', 'public.social_update_settings(boolean, boolean, text)',
    'public.social_follow(uuid)', 'public.social_respond_follow(uuid, boolean)', 'public.social_unfollow(uuid)',
    'public.social_remove_follower(uuid)', 'public.social_follow_requests()',
    'public.social_block(uuid)', 'public.social_unblock(uuid)', 'public.social_blocked_users()',
    'public.social_create_post(text, text, jsonb, text, uuid)', 'public.social_delete_post(uuid)',
    'public.social_set_audience(uuid, text, uuid)', 'public.social_like(uuid)', 'public.social_unlike(uuid)',
    'public.social_feed(timestamptz, integer)', 'public.social_discover(timestamptz, integer)',
    'public.social_user_posts(uuid, timestamptz, integer)', 'public.social_group_posts(uuid, timestamptz, integer)',
    'public.social_post(uuid)', 'public.social_profile(uuid)', 'public.social_search_users(text)',
    'public.social_followers(uuid)', 'public.social_following(uuid)',
    'public.social_notifications_list(timestamptz, integer)', 'public.social_unread_count()', 'public.social_mark_read(uuid[])',
    'public.group_create(text, text, text)', 'public.group_update(uuid, text, text, text)', 'public.group_join(uuid)',
    'public.group_join_by_code(text)', 'public.group_invite(uuid, uuid)', 'public.group_respond(uuid, boolean, uuid)',
    'public.group_set_role(uuid, uuid, text)', 'public.group_remove_member(uuid, uuid)', 'public.group_leave(uuid)',
    'public.group_rotate_code(uuid)', 'public.group_delete(uuid)', 'public.social_my_groups()', 'public.social_group(uuid)',
    'public.social_search_groups(text)', 'public.social_group_members(uuid)',
    'public.social_report(text, uuid, text)', 'public.admin_list_reports(text)', 'public.admin_resolve_report(uuid)',
    'public.admin_remove_post(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
