-- Faz 3 step 4: push reminders (docs/faz3-spec.md section 5).
--
-- Flow: pg_cron runs public.dispatch_reminders() every 5 minutes. It finds habits / to-dos whose
-- remind_at falls in the last 5 minutes (Europe/Istanbul), are due today and not done yet, logs each
-- one once per day in private.reminder_log, groups them per user and queues one pg_net POST per batch
-- of up to 100 messages to the push-send Edge Function (header x-dispatch-secret). The Edge Function
-- encrypts and delivers them and reports dead endpoints back through prune_push_subscriptions().
--
-- Privacy: push_subscriptions is owner-only (select/delete); writes go through register_push /
-- unregister_push. The dispatch secret and the reminder log live in schema "private", which no
-- client role can reach. dispatch_reminders() and set_push_config() are never granted to clients.

-- ---------------------------------------------------------------------------------------------
-- Extensions (hosted Supabase: the same statements the dashboard runs)

create extension if not exists pg_net with schema extensions;   -- objects live in schema "net"
create extension if not exists pg_cron with schema pg_catalog;  -- objects live in schema "cron"

-- ---------------------------------------------------------------------------------------------
-- Device subscriptions (one row per browser push endpoint)

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique
    check (endpoint ~ '^https://[^[:space:]]+$' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) between 1 and 200),
  auth text not null check (char_length(auth) between 1 and 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists push_subscriptions_user_created_idx on public.push_subscriptions (user_id, created_at desc);

alter table public.push_subscriptions enable row level security;

-- Owner reads and deletes; no insert/update policies (writes only through the RPCs below).
drop policy if exists "push_subscriptions_owner_select" on public.push_subscriptions;
create policy "push_subscriptions_owner_select" on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid() and public.can_access());
drop policy if exists "push_subscriptions_owner_delete" on public.push_subscriptions;
create policy "push_subscriptions_owner_delete" on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid() and public.can_access());

revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

drop trigger if exists push_subscriptions_set_updated_at on public.push_subscriptions;
create trigger push_subscriptions_set_updated_at before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

-- Reminder scans: only rows with a reminder are looked at every 5 minutes.
create index if not exists habits_remind_idx on public.habits (remind_at)
  where remind_at is not null and archived_at is null;
create index if not exists todos_remind_idx on public.todos (remind_at)
  where remind_at is not null and archived_at is null;

-- ---------------------------------------------------------------------------------------------
-- Client RPCs

-- Subscribe this device for the caller. A device that switched accounts keeps one row: any row with
-- the same endpoint (whoever owned it) is replaced. At most 10 devices per user (oldest dropped).
create or replace function public.register_push(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.can_access() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_endpoint is null or char_length(p_endpoint) > 1000 or p_endpoint !~ '^https://[^[:space:]]+$' then
    raise exception 'BAD_ENDPOINT' using errcode = '22023';
  end if;
  -- Browser keys are base64url (base64 tolerated): p256dh 65 bytes, auth 16 bytes.
  if p_p256dh is null or char_length(p_p256dh) not between 1 and 200 or p_p256dh !~ '^[A-Za-z0-9_+/-]+=*$'
     or p_auth is null or char_length(p_auth) not between 1 and 100 or p_auth !~ '^[A-Za-z0-9_+/-]+=*$' then
    raise exception 'BAD_KEY' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('push:' || uid::text, 0));
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at)
  values (uid, p_endpoint, p_p256dh, p_auth, nullif(left(btrim(coalesce(p_user_agent, '')), 300), ''), clock_timestamp());
  delete from public.push_subscriptions s
   where s.user_id = uid
     and s.id not in (select k.id from public.push_subscriptions k where k.user_id = uid
                       order by k.created_at desc, k.id limit 10);
end;
$$;

-- Unsubscribe this device: only the caller's own row is touched.
create or replace function public.unregister_push(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  delete from public.push_subscriptions where user_id = auth.uid() and endpoint = p_endpoint;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Private schema: dispatch secret + sent log (no client role can reach it)

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.push_config (
  id boolean primary key default true check (id),
  function_url text,
  secret text
);

create table if not exists private.reminder_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  ref text not null,
  day date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, ref, day)
);
create index if not exists reminder_log_day_idx on private.reminder_log (day);

revoke all on all tables in schema private from public, anon, authenticated;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

-- Deploy workflow (service_role) stores the Edge Function URL and the shared secret.
-- A null URL removes the config (reminders stop).
create or replace function public.set_push_config(p_url text, p_secret text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_url is null then
    delete from private.push_config;
    return;
  end if;
  if char_length(p_url) > 500 or p_url !~ '^https?://[^[:space:]]+$' then
    raise exception 'BAD_URL' using errcode = '22023';
  end if;
  if p_secret is null or char_length(p_secret) not between 32 and 200 then
    raise exception 'BAD_SECRET' using errcode = '22023';
  end if;
  insert into private.push_config (id, function_url, secret) values (true, p_url, p_secret)
  on conflict (id) do update set function_url = excluded.function_url, secret = excluded.secret;
end;
$$;

-- Called by the push-send Edge Function with the anon key (it has no user JWT and no service_role)
-- to drop endpoints the push service answered 404/410. The shared secret is the authorisation.
create or replace function public.prune_push_subscriptions(p_secret text, p_endpoints text[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_secret text;
  v_count integer;
begin
  select c.secret into v_secret from private.push_config c where c.id;
  -- Compare digests, not the raw strings (no early-exit timing on the secret itself).
  if v_secret is null or p_secret is null
     or sha256(convert_to(p_secret, 'UTF8')) <> sha256(convert_to(v_secret, 'UTF8')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_endpoints is null or cardinality(p_endpoints) = 0 then
    return 0;
  end if;
  if cardinality(p_endpoints) > 1000 then
    raise exception 'TOO_MANY' using errcode = '22023';
  end if;
  delete from public.push_subscriptions where endpoint = any (p_endpoints);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Dispatcher

-- Reminders due on p_day with remind_at in [p_from, p_to] (all users). Habits: active that day, an
-- occurrence, below today's target and, for weekly_count, the week's quota still open (days done
-- earlier this ISO week < n). To-dos: one-off due that day and never completed, or a recurring
-- occurrence (not archived) with no completion for that day. Internal: not callable by clients.
create or replace function private.reminders_due(p_day date, p_from time, p_to time)
returns table (user_id uuid, ref text, label text, remind_at time)
language sql stable set search_path = public as $$
  select h.user_id, 'habit:' || h.id::text, h.name, h.remind_at
    from public.habits h
   where h.remind_at between p_from and p_to
     and (h.archived_at is null or (h.archived_at at time zone 'Europe/Istanbul')::date > p_day)
     and public.recurrence_matches(h.rule, h.starts_on, p_day)
     and coalesce((select l.count from public.habit_logs l where l.habit_id = h.id and l.day = p_day), 0) < h.target_count
     and (h.rule ->> 'type' is distinct from 'weekly_count'
          or (select count(*) from public.habit_logs l
               where l.habit_id = h.id
                 and l.day >= p_day - (extract(isodow from p_day)::int - 1) and l.day < p_day
                 and l.count >= h.target_count) < (h.rule ->> 'n')::int)
  union all
  select t.user_id, 'todo:' || t.id::text, t.title, t.remind_at
    from public.todos t
   where t.remind_at between p_from and p_to
     and t.archived_at is null
     and case when t.rule is null then t.due_on is not distinct from p_day
              else public.recurrence_matches(t.rule, t.starts_on, p_day) end
     and not exists (select 1 from public.todo_completions c
                      where c.todo_id = t.id and (t.rule is null or c.day = p_day))
$$;
revoke all on function private.reminders_due(date, time, time) from public, anon, authenticated;

-- Cron entry point (every 5 minutes). Window = [local time - 5 min, local time] of today, clamped at
-- midnight (no wrap). Each (user, item, day) is sent once (reminder_log). Only approved, unblocked
-- users with at least one device. Returns the number of messages queued (one per device).
create or replace function public.dispatch_reminders()
returns integer language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_url text;
  v_secret text;
  v_local timestamp := now() at time zone 'Europe/Istanbul';
  v_day date := v_local::date;
  v_to time := v_local::time;
  v_from time := case when v_local::time < time '00:05' then time '00:00' else v_local::time - interval '5 minutes' end;
  v_users jsonb;
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

  if jsonb_array_length(v_users) = 0 then
    return 0;
  end if;

  for v_batch in
    select jsonb_agg(m.msg order by m.rn) as msgs, count(*)::int as n
      from (select row_number() over (order by u.user_id, s.created_at, s.id) - 1 as rn,
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

  update public.push_subscriptions s set last_used_at = now()
   where s.user_id in (select (e ->> 'user_id')::uuid from jsonb_array_elements(v_users) e);

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges (rule 8: nothing in public is executable unless granted here)

revoke execute on function public.register_push(text, text, text, text), public.unregister_push(text),
  public.set_push_config(text, text), public.prune_push_subscriptions(text, text[]), public.dispatch_reminders()
  from public, anon, authenticated;
grant execute on function public.register_push(text, text, text, text), public.unregister_push(text) to authenticated;
-- The push-send Edge Function calls this with the anon key; the shared secret is checked inside.
grant execute on function public.prune_push_subscriptions(text, text[]) to anon, authenticated, service_role;
-- Deploy workflow only.
grant execute on function public.set_push_config(text, text) to service_role;
-- dispatch_reminders(): run by pg_cron as the owner; never granted.

-- ---------------------------------------------------------------------------------------------
-- Schedule (idempotent: replace the job if it already exists)

do $$
begin
  if exists (select 1 from cron.job where jobname = 'push-reminders') then
    perform cron.unschedule('push-reminders');
  end if;
  perform cron.schedule('push-reminders', '*/5 * * * *', 'select public.dispatch_reminders()');
end;
$$;
