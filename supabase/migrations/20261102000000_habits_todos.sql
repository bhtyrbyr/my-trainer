-- Faz 3: habits + to-dos (docs/faz3-spec.md sections 1-3).
--
-- habits / habit_logs: a habit is due by its recurrence rule; a log row holds the day's count. A day is
-- complete when count >= habits.target_count (yes/no habits: target 1, one row = done).
-- todos / todo_completions: one-off (rule null, optional due_on) or recurring (rule). A completion row
-- per ticked occurrence.
-- Points (seeded rules): habit_done 10 (max 50/day), todo_done 5 (max 30/day), written only by the
-- triggers below. Owner-only RLS; parent rows must belong to the same user (no guessed foreign ids).

-- ---------------------------------------------------------------------------------------------
-- Recurrence helpers (twins of src/lib/recurrence.ts; shared vectors in recurrence.vectors.json).
-- Pure and immutable: not security definer. They back check constraints and the completion guard,
-- which run with the caller's privileges, so authenticated needs EXECUTE (granted at the end).

create or replace function public.recurrence_valid(p_rule jsonb, p_allow_weekly_count boolean)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  v_num numeric;
  v_vals numeric[];
begin
  if p_rule is null or jsonb_typeof(p_rule) <> 'object' or jsonb_typeof(p_rule -> 'type') is distinct from 'string' then
    return false;
  end if;
  case p_rule ->> 'type'
    when 'daily' then
      return true;
    when 'weekly' then
      if jsonb_typeof(p_rule -> 'days') is distinct from 'array' or jsonb_array_length(p_rule -> 'days') < 1 then
        return false;
      end if;
      if exists (select 1 from jsonb_array_elements(p_rule -> 'days') e where jsonb_typeof(e) <> 'number') then
        return false;
      end if;
      select array_agg((e #>> '{}')::numeric) into v_vals from jsonb_array_elements(p_rule -> 'days') e;
      return not exists (select 1 from unnest(v_vals) x where x < 1 or x > 7 or x <> trunc(x))
         and (select count(distinct x) from unnest(v_vals) x) = cardinality(v_vals);
    when 'weekly_count' then
      v_num := case when jsonb_typeof(p_rule -> 'n') = 'number' then (p_rule ->> 'n')::numeric end;
      return coalesce(p_allow_weekly_count, false) and v_num is not null and v_num between 1 and 7 and v_num = trunc(v_num);
    when 'monthly' then
      v_num := case when jsonb_typeof(p_rule -> 'day') = 'number' then (p_rule ->> 'day')::numeric end;
      return v_num is not null and v_num between 1 and 31 and v_num = trunc(v_num);
    when 'every' then
      v_num := case when jsonb_typeof(p_rule -> 'n') = 'number' then (p_rule ->> 'n')::numeric end;
      return v_num is not null and v_num between 2 and 365 and v_num = trunc(v_num);
    else
      return false;
  end case;
end;
$$;

-- Is p_day an occurrence? ISO weekdays (1 = Monday); monthly day clamped to the month's last day;
-- every n days counted from starts_on; weekly_count: every day qualifies (the week's quota is the
-- client's concern). Nothing before starts_on. Invalid/unknown rules never match.
create or replace function public.recurrence_matches(p_rule jsonb, p_starts_on date, p_day date)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  v_first date;
  v_last integer;
begin
  if p_rule is null or p_starts_on is null or p_day is null or jsonb_typeof(p_rule) <> 'object' then
    return false;
  end if;
  if p_day < p_starts_on then
    return false;
  end if;
  case p_rule ->> 'type'
    when 'daily', 'weekly_count' then
      return true;
    when 'weekly' then
      if jsonb_typeof(p_rule -> 'days') is distinct from 'array' then return false; end if;
      return exists (
        select 1 from jsonb_array_elements(p_rule -> 'days') e
        where jsonb_typeof(e) = 'number' and (e #>> '{}')::numeric = extract(isodow from p_day)
      );
    when 'monthly' then
      if jsonb_typeof(p_rule -> 'day') is distinct from 'number' then return false; end if;
      v_first := p_day - (extract(day from p_day)::int - 1);
      v_last := extract(day from ((v_first + interval '1 month')::date - 1))::int;
      return extract(day from p_day) = least((p_rule ->> 'day')::numeric, v_last);
    when 'every' then
      if jsonb_typeof(p_rule -> 'n') is distinct from 'number' or (p_rule ->> 'n')::numeric < 1 then return false; end if;
      return (p_day - p_starts_on) % ((p_rule ->> 'n')::numeric)::int = 0;
    else
      return false;
  end case;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  emoji text check (emoji is null or char_length(emoji) <= 8),
  rule jsonb not null default '{"type":"daily"}'::jsonb check (public.recurrence_valid(rule, true)),
  target_count integer not null default 1 check (target_count between 1 and 999),
  unit text check (unit is null or char_length(unit) <= 16),
  starts_on date not null default ((now() at time zone 'Europe/Istanbul')::date),
  remind_at time,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists habits_user_starts_idx on public.habits (user_id, starts_on);

create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  day date not null,
  count integer not null default 1 check (count between 1 and 9999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (habit_id, day)
);
create index if not exists habit_logs_user_day_idx on public.habit_logs (user_id, day desc);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  note text check (note is null or char_length(note) <= 1000),
  priority smallint not null default 0 check (priority between 0 and 2),
  due_on date,
  rule jsonb check (rule is null or public.recurrence_valid(rule, false)),
  starts_on date not null default ((now() at time zone 'Europe/Istanbul')::date),
  remind_at time,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint todos_remind_needs_day check (remind_at is null or due_on is not null or rule is not null),
  constraint todos_recurring_no_due check (rule is null or due_on is null)
);
create index if not exists todos_user_due_idx on public.todos (user_id, due_on);

create table if not exists public.todo_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  todo_id uuid not null references public.todos(id) on delete cascade,
  day date not null,
  completed_on date not null default ((now() at time zone 'Europe/Istanbul')::date),
  created_at timestamptz not null default now(),
  unique (todo_id, day)
);
create index if not exists todo_completions_user_day_idx on public.todo_completions (user_id, day desc);
create index if not exists todo_completions_user_completed_idx on public.todo_completions (user_id, completed_on desc);

-- ---------------------------------------------------------------------------------------------
-- RLS: owner only

alter table public.habits enable row level security;
alter table public.habit_logs enable row level security;
alter table public.todos enable row level security;
alter table public.todo_completions enable row level security;

drop policy if exists "habits_owner_all" on public.habits;
create policy "habits_owner_all" on public.habits for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());
drop policy if exists "habit_logs_owner_all" on public.habit_logs;
create policy "habit_logs_owner_all" on public.habit_logs for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());
drop policy if exists "todos_owner_all" on public.todos;
create policy "todos_owner_all" on public.todos for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());
drop policy if exists "todo_completions_owner_all" on public.todo_completions;
create policy "todo_completions_owner_all" on public.todo_completions for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());

drop trigger if exists habits_set_updated_at on public.habits;
create trigger habits_set_updated_at before update on public.habits
  for each row execute function public.set_updated_at();
drop trigger if exists habit_logs_set_updated_at on public.habit_logs;
create trigger habit_logs_set_updated_at before update on public.habit_logs
  for each row execute function public.set_updated_at();
drop trigger if exists todos_set_updated_at on public.todos;
create trigger todos_set_updated_at before update on public.todos
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Guards (caller's privileges, so every lookup below is also limited by RLS)

-- Habits: owner frozen; at most 50 active (non-archived) habits per user.
create or replace function public.habits_guard()
returns trigger language plpgsql set search_path = public set timezone = 'Europe/Istanbul' as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
  end if;
  if new.archived_at is null and (tg_op = 'INSERT' or old.archived_at is not null) then
    perform pg_advisory_xact_lock(hashtextextended('habits:' || new.user_id::text, 0));
    if (select count(*) from public.habits h
         where h.user_id = new.user_id and h.archived_at is null and h.id <> new.id) >= 50 then
      raise exception 'LIMIT_REACHED' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists habits_guard on public.habits;
create trigger habits_guard before insert or update on public.habits
  for each row execute function public.habits_guard();

-- To-dos: owner frozen; at most 500 per user.
create or replace function public.todos_guard()
returns trigger language plpgsql set search_path = public set timezone = 'Europe/Istanbul' as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('todos:' || new.user_id::text, 0));
  if (select count(*) from public.todos t where t.user_id = new.user_id) >= 500 then
    raise exception 'LIMIT_REACHED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists todos_guard on public.todos;
create trigger todos_guard before insert or update on public.todos
  for each row execute function public.todos_guard();

-- Habit logs: the habit must be the caller's own (FORBIDDEN otherwise), no future days; owner, habit
-- and day are frozen on update (only count changes).
create or replace function public.habit_logs_guard()
returns trigger language plpgsql set search_path = public set timezone = 'Europe/Istanbul' as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.habit_id := old.habit_id;
    new.day := old.day;
    return new;
  end if;
  if not exists (select 1 from public.habits h where h.id = new.habit_id and h.user_id = new.user_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if new.day > current_date then
    raise exception 'FUTURE_DATE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists habit_logs_guard on public.habit_logs;
create trigger habit_logs_guard before insert or update on public.habit_logs
  for each row execute function public.habit_logs_guard();

-- To-do completions: the to-do must be the caller's own (FORBIDDEN). Ticked day (completed_on) never
-- in the future. One-off: the occurrence day is derived (coalesce(due_on, completed_on)), at most one
-- completion (ALREADY_DONE); ticking early is allowed. Recurring: day not in the future and must be an
-- occurrence (NOT_DUE). Rows are immutable once written (un-tick = delete).
create or replace function public.todo_completions_guard()
returns trigger language plpgsql set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  t public.todos%rowtype;
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.todo_id := old.todo_id;
    new.day := old.day;
    new.completed_on := old.completed_on;
    return new;
  end if;
  select * into t from public.todos where id = new.todo_id and user_id = new.user_id;
  if not found then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if new.completed_on > current_date then
    raise exception 'FUTURE_DATE' using errcode = 'P0001';
  end if;
  if t.rule is null then
    new.day := coalesce(t.due_on, new.completed_on);
    if exists (select 1 from public.todo_completions c where c.todo_id = new.todo_id) then
      raise exception 'ALREADY_DONE' using errcode = 'P0001';
    end if;
  else
    if new.day > current_date then
      raise exception 'FUTURE_DATE' using errcode = 'P0001';
    end if;
    if not public.recurrence_matches(t.rule, t.starts_on, new.day) then
      raise exception 'NOT_DUE' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists todo_completions_guard on public.todo_completions;
create trigger todo_completions_guard before insert or update on public.todo_completions
  for each row execute function public.todo_completions_guard();

-- ---------------------------------------------------------------------------------------------
-- Points (security definer, never granted to clients)

-- habit_done: awarded when the day's count reaches the habit's current target, revoked when an edit
-- drops it below again or the log is deleted. Only threshold crossings act, so raising target_count
-- later does not re-score a past day unless that day's count is edited across the new target.
create or replace function public.habit_logs_points()
returns trigger language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_target integer;
  v_ref text;
begin
  if tg_op = 'DELETE' then
    perform public.revoke_points(old.user_id, 'habit_logs', old.habit_id::text || ':' || old.day::text);
    return old;
  end if;
  v_ref := new.habit_id::text || ':' || new.day::text;
  select h.target_count into v_target from public.habits h where h.id = new.habit_id;
  v_target := coalesce(v_target, 1);
  if new.count >= v_target then
    if tg_op = 'INSERT' or old.count < v_target then
      perform public.award_points(new.user_id, 'habit_done', new.day, 'habit_logs', v_ref);
    end if;
  elsif tg_op = 'UPDATE' and old.count >= v_target then
    perform public.revoke_points(new.user_id, 'habit_logs', v_ref);
  end if;
  return new;
end;
$$;
drop trigger if exists habit_logs_points on public.habit_logs;
create trigger habit_logs_points after insert or update of count or delete on public.habit_logs
  for each row execute function public.habit_logs_points();

-- todo_done: awarded on the tick day (completed_on), revoked on un-tick (delete, also by cascade).
create or replace function public.todo_completions_points()
returns trigger language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
begin
  if tg_op = 'DELETE' then
    perform public.revoke_points(old.user_id, 'todo_completions', old.todo_id::text || ':' || old.day::text);
    return old;
  end if;
  perform public.award_points(new.user_id, 'todo_done', new.completed_on, 'todo_completions',
                              new.todo_id::text || ':' || new.day::text);
  return new;
end;
$$;
drop trigger if exists todo_completions_points on public.todo_completions;
create trigger todo_completions_points after insert or delete on public.todo_completions
  for each row execute function public.todo_completions_points();

-- ---------------------------------------------------------------------------------------------
-- Privileges

revoke execute on function public.habits_guard(), public.todos_guard(), public.habit_logs_guard(),
  public.todo_completions_guard(), public.habit_logs_points(), public.todo_completions_points()
  from public, anon, authenticated;

-- Pure helpers used by check constraints and the completion guard, which run as the caller.
revoke execute on function public.recurrence_valid(jsonb, boolean), public.recurrence_matches(jsonb, date, date)
  from public, anon;
grant execute on function public.recurrence_valid(jsonb, boolean), public.recurrence_matches(jsonb, date, date)
  to authenticated;
