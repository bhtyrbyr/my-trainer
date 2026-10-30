-- The AI consent text was widened to cover the coach (2026-10-31): a consent to an older text no longer
-- counts. The minimum version lives in app_config so a later wording change only needs a new value.
insert into public.app_config (key, value) values ('ai_consent_version', '"2026-10-31"'::jsonb)
on conflict (key) do update set value = excluded.value;

create or replace function public.ai_consent_of(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.granted
            and c.version >= coalesce((select value #>> '{}' from public.app_config where key = 'ai_consent_version'), '')
       from public.user_consents c
      where c.user_id = p_user and c.kind = 'ai_processing'
      order by c.id desc limit 1),
    false)
$$;
revoke execute on function public.ai_consent_of(uuid) from public, anon, authenticated;
