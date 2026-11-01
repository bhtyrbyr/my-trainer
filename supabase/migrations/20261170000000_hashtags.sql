-- Hashtags on Community posts.
--   A  tag rule (internal helpers): extraction, normalisation, parsing of a typed tag
--   B  table post_tags (derived from posts.body; RLS on, no policies, no grants: reads only via RPCs)
--   C  trigger on posts (insert / update of body or created_at) replaces the post's tags; backfill
--   D  RPCs social_tag_posts (same rows as social_discover) and social_search_tags (visible counts only)
--
-- Tag rule (the frontend uses exactly the same rule):
--   '#' + 2..30 chars of [0-9A-Za-zÇĞİÖŞÜçğıöşü_], the '#' not preceded by one of those chars or '&'
--   (so 'a#bc' and HTML entities are not tags), not followed by another tag char (a longer run is not
--   a tag), not all digits. Same rule as src/features/social/hashtags.ts.
--   Normalise: 'İ' -> 'i', 'I' -> 'ı', then lower case. Stored without '#'. At most 10 distinct tags per
--   post, in order of first appearance.
-- Idempotent: create if not exists / create or replace / drop ... if exists.

-- -----------------------------------------------------------------------------
-- A. Tag rule (private schema; never granted)
-- -----------------------------------------------------------------------------
-- translate() instead of relying on lower() for the Turkish letters: the result does not depend on the
-- database's LC_CTYPE. Only ASCII A-Z is left for lower().
create or replace function private.tag_norm(p text)
returns text language sql immutable set search_path = pg_catalog as $$
  select lower(translate(p, 'İIÇĞÖŞÜ', 'iıçğöşü'))
$$;

create or replace function private.post_tag_list(p_body text)
returns text[] language sql immutable set search_path = pg_catalog as $$
  select coalesce(array_agg(t.tag order by t.first_pos), '{}'::text[])
    from (select private.tag_norm(m.match[1]) as tag, min(m.ord) as first_pos
            from regexp_matches(coalesce(p_body, ''),
                                '(?<![0-9A-Za-zÇĞİÖŞÜçğıöşü_&])#([0-9A-Za-zÇĞİÖŞÜçğıöşü_]{2,30})(?![0-9A-Za-zÇĞİÖŞÜçğıöşü_])', 'g')
                 with ordinality as m(match, ord)
           where m.match[1] !~ '^[0-9]+$'
           group by 1
           order by 2
           limit 10) t
$$;

-- A tag typed by the user (optional leading '#'): normalised, or null when it is not a valid tag.
create or replace function private.tag_parse(p text)
returns text language sql immutable set search_path = pg_catalog as $$
  select case when s.x ~ '^[0-9A-Za-zÇĞİÖŞÜçğıöşü_]{2,30}$' and s.x !~ '^[0-9]+$' then private.tag_norm(s.x) end
    from (select regexp_replace(btrim(coalesce(p, '')), '^#', '') as x) s
$$;

-- -----------------------------------------------------------------------------
-- B. Table (derived data; no direct client access)
-- -----------------------------------------------------------------------------
create table if not exists public.post_tags (
  post_id uuid not null references public.posts(id) on delete cascade,
  tag text not null check (tag ~ '^[0-9a-zçğıöşü_]{2,30}$'),
  created_at timestamptz not null,
  primary key (post_id, tag)
);
create index if not exists post_tags_tag_created_idx on public.post_tags (tag, created_at desc, post_id);
alter table public.post_tags enable row level security;
revoke all on public.post_tags from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- C. Trigger + backfill
-- -----------------------------------------------------------------------------
create or replace function private.post_tags_sync()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body and new.created_at = old.created_at then
    return null;
  end if;
  delete from public.post_tags where post_id = new.id;
  insert into public.post_tags (post_id, tag, created_at)
  select new.id, t.tag, new.created_at from unnest(private.post_tag_list(new.body)) as t(tag);
  return null;
end;
$$;
drop trigger if exists posts_sync_tags on public.posts;
create trigger posts_sync_tags after insert or update of body, created_at on public.posts
  for each row execute function private.post_tags_sync();

insert into public.post_tags (post_id, tag, created_at)
select p.id, t.tag, p.created_at
  from public.posts p
 cross join lateral unnest(private.post_tag_list(p.body)) as t(tag)
 where p.body like '%#%'
on conflict (post_id, tag) do nothing;

-- -----------------------------------------------------------------------------
-- D. RPCs
-- -----------------------------------------------------------------------------
-- Posts with a tag, newest first (keyset by p_before), only those the caller may view. A tag page is a
-- discovery surface, so authors who turned "discoverable" off reach only their followers and fellow
-- group members here (as in social_discover / social_search_users); the author always sees own posts.
create or replace function public.social_tag_posts(p_tag text, p_before timestamptz default null, p_limit integer default 20)
returns setof public.social_post_item language plpgsql stable security definer set search_path = public, private as $$
declare
  v uuid := private.social_viewer();
  t text := private.tag_parse(p_tag);
begin
  if v is null or t is null then return; end if;
  return query select * from private.render_posts(v, array(
    select pt.post_id from public.post_tags pt
      join public.posts p on p.id = pt.post_id
      join public.social_profiles s on s.user_id = p.author_id
     where pt.tag = t
       and pt.created_at < coalesce(p_before, 'infinity'::timestamptz)
       and (p.author_id = v or s.discoverable or private.follows_accepted(v, p.author_id)
            or (p.group_id is not null and private.group_role(p.group_id, v) is not null))
       and public.can_view_post(pt.post_id)
     order by pt.created_at desc, pt.post_id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)));
end;
$$;

-- Tags starting with the (normalised) query, counting only posts the caller may view on a tag page
-- (same filter as social_tag_posts), so the existence of hidden posts never leaks. Tags with no
-- visible post do not appear.
create or replace function public.social_search_tags(p_query text)
returns table (tag text, post_count integer)
language plpgsql stable security definer set search_path = public, private as $$
#variable_conflict use_column
declare
  v uuid := private.social_viewer();
  q text := regexp_replace(btrim(coalesce(p_query, '')), '^#', '');
begin
  if v is null or char_length(q) < 1 or char_length(q) > 30 or q !~ '^[0-9A-Za-zÇĞİÖŞÜçğıöşü_]+$' then
    return;
  end if;
  q := private.tag_norm(q);
  return query
    select pt.tag, count(*)::int
      from public.post_tags pt
      join public.posts p on p.id = pt.post_id
      join public.social_profiles s on s.user_id = p.author_id
     where starts_with(pt.tag, q)
       and (p.author_id = v or s.discoverable or private.follows_accepted(v, p.author_id)
            or (p.group_id is not null and private.group_role(p.group_id, v) is not null))
       and public.can_view_post(pt.post_id)
     group by pt.tag
     order by 2 desc, 1
     limit 20;
end;
$$;

-- -----------------------------------------------------------------------------
-- E. Grants
-- -----------------------------------------------------------------------------
revoke all on function private.tag_norm(text), private.post_tag_list(text), private.tag_parse(text),
  private.post_tags_sync()
from public, anon, authenticated;
revoke all on function public.social_tag_posts(text, timestamptz, integer), public.social_search_tags(text)
from public, anon;
grant execute on function public.social_tag_posts(text, timestamptz, integer), public.social_search_tags(text)
to authenticated;
