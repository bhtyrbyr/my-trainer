-- @mentions (person tagging) on Community posts.
--   A  social_profiles.allow_mentions; notification kind 'mention'; activity kind 'mention'
--   B  table post_mentions (RLS on, no policies, no grants: reads only via RPCs)
--   C  rule helpers: post_audience_ok() (audience part of can_view_post, now shared), mention_ok()
--   D  can_view_post() rewritten on top of post_audience_ok() (same behaviour, one source of truth)
--   E  triggers: notify on insert, drop the notification on delete, re-validate on audience change,
--      drop mentions between two users when one blocks the other
--   F  social_wipe also removes the user's mentions; social_update_settings gains p_allow_mentions
--   G  social_create_post gains p_mentions (old 5-argument signature dropped)
--   H  social_remove_mention, social_mention_candidates, social_mentioned_posts
--   I  social_post_item gains `mentions jsonb`; render_posts fills it (every feed/post RPC uses it)
--
-- Mention rule (a candidate must pass all of it, for the post's audience/group):
--   a) social-active, not the author, no block either way, allow_mentions on;
--   b) group post: active member of that group; otherwise an accepted follow in either direction;
--   c) could view the post under its audience (post_audience_ok, the same code can_view_post uses).
-- At most 10 per post, 50 per author per day (activity log, survives deletes). Mentions never widen
-- who can see a post: can_view_post does not look at post_mentions.
-- Errors: TOO_MANY_MENTIONS (22023), MENTION_NOT_ALLOWED (P0001), RATE_LIMITED (P0001).
-- Idempotent: create if not exists / create or replace / drop ... if exists.

-- -----------------------------------------------------------------------------
-- A. Columns and check constraints
-- -----------------------------------------------------------------------------
alter table public.social_profiles add column if not exists allow_mentions boolean not null default true;

alter table public.social_notifications drop constraint if exists social_notifications_kind_check;
alter table public.social_notifications add constraint social_notifications_kind_check
  check (kind in ('follow', 'follow_request', 'follow_accepted', 'like',
                  'group_invite', 'group_request', 'group_accepted', 'mention'));

alter table private.social_activity drop constraint if exists social_activity_kind_check;
alter table private.social_activity add constraint social_activity_kind_check
  check (kind in ('post', 'like', 'join_code_fail', 'mention'));

-- -----------------------------------------------------------------------------
-- B. Table (no direct client access)
-- -----------------------------------------------------------------------------
create table if not exists public.post_mentions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists post_mentions_user_created_idx on public.post_mentions (user_id, created_at desc);
alter table public.post_mentions enable row level security;
revoke all on public.post_mentions from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- C. Rule helpers (private schema; never granted)
-- -----------------------------------------------------------------------------
-- The audience part of can_view_post: may p_viewer see a post of p_author with this audience/group?
-- (Social-active, block and media checks stay in can_view_post / mention_ok.)
create or replace function private.post_audience_ok(p_viewer uuid, p_author uuid, p_author_private boolean,
  p_audience text, p_group uuid, p_group_visibility text)
returns boolean language sql stable set search_path = public, private as $$
  select coalesce(case p_audience
    when 'public' then not p_author_private or private.follows_accepted(p_viewer, p_author)
    when 'followers' then private.follows_accepted(p_viewer, p_author)
    when 'friends' then private.follows_accepted(p_viewer, p_author) and private.follows_accepted(p_author, p_viewer)
    when 'group' then private.group_role(p_group, p_author) is not null
                      and (private.group_role(p_group, p_viewer) is not null
                           or (p_group_visibility = 'open' and not p_author_private))
    else false end, false)
$$;

-- May p_author tag p_user on a post with this audience/group? (rules a-c above)
create or replace function private.mention_ok(p_author uuid, p_user uuid, p_author_private boolean,
  p_audience text, p_group uuid, p_group_visibility text)
returns boolean language sql stable set search_path = public, private as $$
  select coalesce(
    p_user is not null and p_user <> p_author
    and private.social_active(p_user)
    and not private.blocked_either(p_author, p_user)
    and (select s.allow_mentions from public.social_profiles s where s.user_id = p_user)
    and case when p_audience = 'group' then private.group_role(p_group, p_user) is not null
             else private.follows_accepted(p_author, p_user) or private.follows_accepted(p_user, p_author) end
    and private.post_audience_ok(p_user, p_author, p_author_private, p_audience, p_group, p_group_visibility), false)
$$;

-- -----------------------------------------------------------------------------
-- D. can_view_post (20261160000000 behaviour, audience part delegated to post_audience_ok)
-- -----------------------------------------------------------------------------
create or replace function public.can_view_post(p_post uuid)
returns boolean language sql stable security definer set search_path = public, private as $$
  select coalesce((
    select p.author_id = v.me or (
             private.social_active(v.me) and private.social_active(p.author_id)
             and not private.blocked_either(v.me, p.author_id)
             and (p.kind not in ('photo', 'progress', 'compare')
                  or exists (select 1 from public.post_media m where m.post_id = p.id))
             and private.post_audience_ok(v.me, p.author_id, sp.is_private, p.audience, p.group_id, g.visibility))
      from public.posts p
      join public.social_profiles sp on sp.user_id = p.author_id
      left join public.groups g on g.id = p.group_id
      cross join (select auth.uid() as me) v
     where p.id = p_post and v.me is not null and public.can_access()), false)
$$;

-- -----------------------------------------------------------------------------
-- E. Triggers
-- -----------------------------------------------------------------------------
-- Insert: a 'mention' notification (pushed by dispatch_reminders like every social notification).
-- Delete (untag, re-validation, block, post or account deletion): its notification goes too.
create or replace function private.post_mentions_after()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare
  v_author uuid;
begin
  if tg_op = 'INSERT' then
    select author_id into v_author from public.posts where id = new.post_id;
    if v_author is not null and v_author <> new.user_id then
      insert into public.social_notifications (user_id, kind, actor_id, post_id)
      values (new.user_id, 'mention', v_author, new.post_id);
    end if;
  else
    delete from public.social_notifications
     where user_id = old.user_id and post_id = old.post_id and kind = 'mention';
  end if;
  return null;
end;
$$;
drop trigger if exists post_mentions_after on public.post_mentions;
create trigger post_mentions_after after insert or delete on public.post_mentions
  for each row execute function private.post_mentions_after();

-- Audience / group change: drop the mentions that no longer pass the rule.
create or replace function private.post_mentions_revalidate()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.audience is not distinct from old.audience and new.group_id is not distinct from old.group_id then
    return null;
  end if;
  delete from public.post_mentions m
   where m.post_id = new.id
     and not private.mention_ok(new.author_id, m.user_id,
               coalesce((select s.is_private from public.social_profiles s where s.user_id = new.author_id), true),
               new.audience, new.group_id, (select g.visibility from public.groups g where g.id = new.group_id));
  return null;
end;
$$;
drop trigger if exists posts_revalidate_mentions on public.posts;
create trigger posts_revalidate_mentions after update of audience, group_id on public.posts
  for each row execute function private.post_mentions_revalidate();

-- A block removes the mentions between the two users in both directions.
create or replace function private.blocks_drop_mentions()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  delete from public.post_mentions m using public.posts p
   where p.id = m.post_id
     and ((p.author_id = new.blocker_id and m.user_id = new.blocked_id)
          or (p.author_id = new.blocked_id and m.user_id = new.blocker_id));
  return null;
end;
$$;
drop trigger if exists blocks_drop_mentions on public.blocks;
create trigger blocks_drop_mentions after insert on public.blocks
  for each row execute function private.blocks_drop_mentions();

-- -----------------------------------------------------------------------------
-- F. social_wipe (20261140000000 + mentions of the user, allow_mentions reset); settings
-- -----------------------------------------------------------------------------
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
    delete from public.post_mentions where user_id = p_user;
    delete from public.follows where follower_id = p_user or followee_id = p_user;
    delete from public.social_notifications where user_id = p_user or actor_id = p_user;
    delete from public.reports where reporter_id = p_user;
    update public.social_profiles
       set enabled = false, enabled_at = null, bio = null, is_private = true, discoverable = true,
           allow_mentions = true
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

-- null = unchanged; p_bio '' clears. Going public accepts every pending request.
drop function if exists public.social_update_settings(boolean, boolean, text);
create or replace function public.social_update_settings(p_is_private boolean default null,
  p_discoverable boolean default null, p_bio text default null, p_allow_mentions boolean default null)
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
         bio = case when p_bio is null then bio else v_bio end,
         allow_mentions = coalesce(p_allow_mentions, allow_mentions)
   where user_id = v;
  if v_was_private and p_is_private is false then
    update public.follows set status = 'accepted', accepted_at = now()
     where followee_id = v and status = 'pending';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- G. social_create_post (20261160000000 + p_mentions)
-- -----------------------------------------------------------------------------
drop function if exists public.social_create_post(text, text, jsonb, text, uuid);
create or replace function public.social_create_post(p_kind text, p_body text default null,
  p_payload jsonb default '{}'::jsonb, p_audience text default 'followers', p_group uuid default null,
  p_mentions uuid[] default null)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare
  v uuid := private.social_me();
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_mentions uuid[] := array(select distinct x from unnest(coalesce(p_mentions, '{}'::uuid[])) x where x is not null);
  v_n integer;
  v_private boolean;
  v_group_vis text;
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
  v_n := cardinality(v_mentions);
  if v_n > 10 then
    raise exception 'TOO_MANY_MENTIONS' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('social:' || v::text, 0));
  if private.social_activity_count(v, 'post', private.social_today()) >= 20 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  if v_n > 0 then
    if private.social_activity_count(v, 'mention', private.social_today()) + v_n > 50 then
      raise exception 'RATE_LIMITED' using errcode = 'P0001';
    end if;
    select s.is_private into v_private from public.social_profiles s where s.user_id = v;
    select g.visibility into v_group_vis from public.groups g where g.id = p_group;
    if exists (select 1 from unnest(v_mentions) m(uid)
                where not private.mention_ok(v, m.uid, v_private, p_audience, p_group, v_group_vis)) then
      raise exception 'MENTION_NOT_ALLOWED' using errcode = 'P0001';
    end if;
  end if;
  insert into public.posts (author_id, kind, body, payload, audience, group_id)
  values (v, p_kind, v_body, v_payload, p_audience, p_group)
  returning id into v_id;
  if v_n > 0 then
    insert into public.post_mentions (post_id, user_id) select v_id, m.uid from unnest(v_mentions) m(uid);
    insert into private.social_activity as a (user_id, kind, period_start, count)
    values (v, 'mention', private.social_today(), v_n)
    on conflict (user_id, kind, period_start) do update set count = a.count + excluded.count;
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- H. Untag and candidates
-- -----------------------------------------------------------------------------
-- The tagged user removes themselves; true when a mention was removed.
create or replace function public.social_remove_mention(p_post uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_access() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.post_mentions where post_id = p_post and user_id = auth.uid();
  return found;
end;
$$;

-- People the caller may tag on a post with this audience/group: case-insensitive, Turkish-safe prefix
-- of the username or of any word of the display name (optional leading '@'); empty query = the most
-- recent relations first. At most 8.
create or replace function public.social_mention_candidates(p_query text, p_audience text, p_group uuid default null)
returns table (user_id uuid, username text, display_name text, avatar_path text)
language plpgsql stable security definer set search_path = public, private as $$
#variable_conflict use_column
declare
  v uuid := private.social_viewer();
  q text := private.tag_norm(regexp_replace(btrim(coalesce(p_query, '')), '^@', ''));
  v_private boolean;
  v_group_vis text;
begin
  if v is null or char_length(q) > 30 or p_audience is null
     or p_audience not in ('public', 'followers', 'friends', 'group')
     or (p_audience = 'group') <> (p_group is not null)
     or (p_group is not null and private.group_role(p_group, v) is null) then
    return;
  end if;
  select s.is_private into v_private from public.social_profiles s where s.user_id = v;
  select g.visibility into v_group_vis from public.groups g where g.id = p_group;
  return query
    with rel as (
      select gm.user_id as uid, gm.created_at as at from public.group_members gm
       where p_audience = 'group' and gm.group_id = p_group and gm.status = 'active'
      union all
      select f.followee_id, coalesce(f.accepted_at, f.created_at) from public.follows f
       where p_audience <> 'group' and f.follower_id = v and f.status = 'accepted'
      union all
      select f.follower_id, coalesce(f.accepted_at, f.created_at) from public.follows f
       where p_audience <> 'group' and f.followee_id = v and f.status = 'accepted'
    ), cand as (
      select rel.uid, max(rel.at) as last_at from rel where rel.uid <> v group by rel.uid
    )
    select p.user_id, p.username::text, p.display_name, p.avatar_path
      from cand c
      join public.profiles p on p.user_id = c.uid
     where (q = '' or starts_with(private.tag_norm(p.username::text), q)
            or starts_with(private.tag_norm(p.display_name), q)
            or position(' ' || q in private.tag_norm(p.display_name)) > 0)
       and private.mention_ok(v, c.uid, v_private, p_audience, p_group, v_group_vis)
     order by (q <> '' and starts_with(private.tag_norm(p.username::text), q)) desc, c.last_at desc, p.username
     limit 8;
end;
$$;

-- -----------------------------------------------------------------------------
-- I. Post rows carry their mentions
-- -----------------------------------------------------------------------------
-- Adding an attribute keeps the type's oid, so every function returning setof social_post_item
-- (social_feed, social_discover, social_user_posts, social_group_posts, social_post, social_tag_posts)
-- keeps working and returns the new column through render_posts.
do $$
begin
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.social_post_item'::regclass and attname = 'mentions' and not attisdropped) then
    alter type public.social_post_item add attribute mentions jsonb;
  end if;
end;
$$;

-- mentions: [{user_id, username, display_name}] in tagging order, only users who are social-active and
-- not blocked with the viewer (blocks with the author already delete the mention).
create or replace function private.render_posts(p_viewer uuid, p_ids uuid[])
returns setof public.social_post_item language sql stable set search_path = public as $$
  select p.id, p.author_id, pr.username::text, pr.display_name, pr.avatar_path,
         p.kind, p.body, p.payload, p.audience, p.group_id, g.name,
         p.like_count,
         exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = p_viewer),
         coalesce((select jsonb_agg(jsonb_build_object('path', m.path, 'width', m.width, 'height', m.height,
                                                       'position', m.position) order by m.position)
                     from public.post_media m where m.post_id = p.id), '[]'::jsonb),
         p.created_at,
         coalesce((select jsonb_agg(jsonb_build_object('user_id', mp.user_id, 'username', mp.username::text,
                                                       'display_name', mp.display_name) order by mn.created_at, mp.username)
                     from public.post_mentions mn
                     join public.profiles mp on mp.user_id = mn.user_id
                    where mn.post_id = p.id
                      and private.social_active(mn.user_id)
                      and (mn.user_id = p_viewer or not private.blocked_either(p_viewer, mn.user_id))), '[]'::jsonb)
    from public.posts p
    join public.profiles pr on pr.user_id = p.author_id
    left join public.groups g on g.id = p.group_id
   where p.id = any (p_ids)
   order by p.created_at desc, p.id desc
$$;

-- Posts the caller is tagged in (caller only), newest first, keyset on created_at; still only posts
-- the caller may view (a blocked author or lost access hides them).
create or replace function public.social_mentioned_posts(p_before timestamptz default null, p_limit integer default 20)
returns setof public.social_post_item language plpgsql stable security definer set search_path = public, private as $$
declare
  v uuid := private.social_viewer();
begin
  if v is null then return; end if;
  return query select * from private.render_posts(v, array(
    select p.id from public.post_mentions mn
      join public.posts p on p.id = mn.post_id
     where mn.user_id = v
       and p.created_at < coalesce(p_before, 'infinity'::timestamptz)
       and public.can_view_post(p.id)
     order by p.created_at desc, p.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)));
end;
$$;

-- -----------------------------------------------------------------------------
-- J. Grants
-- -----------------------------------------------------------------------------
revoke all on function
  private.post_audience_ok(uuid, uuid, boolean, text, uuid, text),
  private.mention_ok(uuid, uuid, boolean, text, uuid, text),
  private.post_mentions_after(), private.post_mentions_revalidate(), private.blocks_drop_mentions(),
  private.social_wipe(uuid, boolean, boolean), private.render_posts(uuid, uuid[])
from public, anon, authenticated;
revoke all on function public.can_view_post(uuid) from public, anon;
grant execute on function public.can_view_post(uuid) to authenticated;
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.social_update_settings(boolean, boolean, text, boolean)',
    'public.social_create_post(text, text, jsonb, text, uuid, uuid[])',
    'public.social_remove_mention(uuid)',
    'public.social_mention_candidates(text, text, uuid)',
    'public.social_mentioned_posts(timestamptz, integer)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
