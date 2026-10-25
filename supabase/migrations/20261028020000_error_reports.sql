-- User-initiated error reports for errors the user cannot fix themselves ("report to admin").
-- The client attaches the failing request (method, path, sanitized body excerpt), the server's
-- error response excerpt, the screen and the app version. Headers and tokens are never included.
-- Users can only create reports for themselves (any signed-in account, also pending ones, so
-- onboarding problems can be reported); only admins can read and resolve them.

create table if not exists public.error_reports (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  route text check (route is null or char_length(route) <= 300),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  message_key text check (message_key is null or char_length(message_key) <= 80),
  error_code text check (error_code is null or char_length(error_code) <= 80),
  error_message text check (error_message is null or char_length(error_message) <= 2000),
  request jsonb check (request is null or pg_column_size(request) <= 8000),
  response jsonb check (response is null or pg_column_size(response) <= 8000),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_at timestamptz
);
create index if not exists error_reports_open_idx on public.error_reports (status, created_at desc);

alter table public.error_reports enable row level security;
drop policy if exists "error_reports_insert_own" on public.error_reports;
create policy "error_reports_insert_own" on public.error_reports for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "error_reports_admin_read" on public.error_reports;
create policy "error_reports_admin_read" on public.error_reports for select to authenticated
  using (public.is_admin());
drop policy if exists "error_reports_admin_update" on public.error_reports;
create policy "error_reports_admin_update" on public.error_reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "error_reports_admin_delete" on public.error_reports;
create policy "error_reports_admin_delete" on public.error_reports for delete to authenticated
  using (public.is_admin());

-- Abuse guard: at most 30 reports per user per day; new reports are always open.
create or replace function public.error_reports_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'open';
    new.resolved_at := null;
    if (select count(*) from public.error_reports where user_id = new.user_id and created_at > now() - interval '1 day') >= 30 then
      raise exception 'REPORT_LIMIT' using errcode = 'P0001';
    end if;
  else
    new.user_id := old.user_id;
    new.resolved_at := case when new.status = 'resolved' then coalesce(old.resolved_at, now()) else null end;
  end if;
  return new;
end;
$$;
revoke execute on function public.error_reports_guard() from public, anon, authenticated;
drop trigger if exists error_reports_guard on public.error_reports;
create trigger error_reports_guard before insert or update on public.error_reports
  for each row execute function public.error_reports_guard();

-- Admin list with the reporter's public profile fields (no email).
create or replace function public.admin_error_reports(p_status text default 'open', p_limit integer default 100)
returns table (
  id bigint,
  created_at timestamptz,
  user_id uuid,
  username text,
  display_name text,
  route text,
  app_version text,
  message_key text,
  error_code text,
  error_message text,
  request jsonb,
  response jsonb,
  user_agent text,
  note text,
  status text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select r.id, r.created_at, r.user_id, p.username::text, p.display_name, r.route, r.app_version, r.message_key,
           r.error_code, r.error_message, r.request, r.response, r.user_agent, r.note, r.status
    from public.error_reports r
    left join public.profiles p on p.user_id = r.user_id
    where p_status = 'all' or r.status = p_status
    order by r.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;
revoke execute on function public.admin_error_reports(text, integer) from public, anon;
grant execute on function public.admin_error_reports(text, integer) to authenticated;
