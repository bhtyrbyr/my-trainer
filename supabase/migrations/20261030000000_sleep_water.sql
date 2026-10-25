-- Faz 2, step 4: sleep and water (M4).
--
-- sleep_entries: one night per user per wake-up day (sleep_on = local date of wake_at, set by
-- trigger). Duration is derived. Points (seeded rule sleep_log): 5, or 10 when the night is >= 7 h.
-- water_entries: individual drinks per local day. Points (water_goal): 10 once the day's total
-- reaches user_settings.daily_water_ml; revoked if an edit/delete drops it below again.
-- Owner-only RLS; no future days; owner frozen on update.

create table if not exists public.sleep_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sleep_on date not null,
  bed_at timestamptz not null,
  wake_at timestamptz not null,
  duration_min integer not null default 0 check (duration_min between 0 and 1200),
  quality smallint check (quality is null or quality between 1 and 5),
  note text check (note is null or char_length(note) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, sleep_on)
);
create index if not exists sleep_entries_user_day_idx on public.sleep_entries (user_id, sleep_on desc);

create table if not exists public.water_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  drunk_on date not null,
  amount_ml integer not null check (amount_ml between 10 and 3000),
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists water_entries_user_day_idx on public.water_entries (user_id, drunk_on desc);

alter table public.sleep_entries enable row level security;
alter table public.water_entries enable row level security;
drop policy if exists "sleep_entries_owner_all" on public.sleep_entries;
create policy "sleep_entries_owner_all" on public.sleep_entries for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());
drop policy if exists "water_entries_owner_all" on public.water_entries;
create policy "water_entries_owner_all" on public.water_entries for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());

drop trigger if exists sleep_entries_set_updated_at on public.sleep_entries;
create trigger sleep_entries_set_updated_at before update on public.sleep_entries
  for each row execute function public.set_updated_at();

-- Sleep: derive the day and duration; validate the window.
create or replace function public.sleep_entries_guard()
returns trigger language plpgsql set search_path = public set timezone = 'Europe/Istanbul' as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
  end if;
  if new.wake_at <= new.bed_at then
    raise exception 'SLEEP_ORDER' using errcode = 'P0001';
  end if;
  if new.wake_at > now() + interval '1 hour' then
    raise exception 'FUTURE_DATE' using errcode = 'P0001';
  end if;
  new.duration_min := floor(extract(epoch from (new.wake_at - new.bed_at)) / 60)::int;
  if new.duration_min > 1200 then
    raise exception 'SLEEP_TOO_LONG' using errcode = 'P0001';
  end if;
  new.sleep_on := new.wake_at::date;
  return new;
end;
$$;
drop trigger if exists sleep_entries_guard on public.sleep_entries;
create trigger sleep_entries_guard before insert or update on public.sleep_entries
  for each row execute function public.sleep_entries_guard();

create or replace function public.sleep_entries_points()
returns trigger language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.revoke_points(old.user_id, 'sleep_entries', old.id::text);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  perform public.award_points(new.user_id, 'sleep_log', new.sleep_on, 'sleep_entries', new.id::text,
                              case when new.duration_min >= 420 then 10 else 5 end);
  return new;
end;
$$;
drop trigger if exists sleep_entries_points on public.sleep_entries;
create trigger sleep_entries_points after insert or update of bed_at, wake_at or delete on public.sleep_entries
  for each row execute function public.sleep_entries_points();

-- Water: no future days, owner frozen.
create or replace function public.water_entries_guard()
returns trigger language plpgsql set search_path = public set timezone = 'Europe/Istanbul' as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
  end if;
  if new.drunk_on > current_date then
    raise exception 'FUTURE_DATE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists water_entries_guard on public.water_entries;
create trigger water_entries_guard before insert or update on public.water_entries
  for each row execute function public.water_entries_guard();

create or replace function public.sync_water_goal(p_user uuid, p_day date)
returns void language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_goal integer := coalesce((select daily_water_ml from public.user_settings where user_id = p_user), 2500);
  v_sum integer := coalesce((select sum(amount_ml) from public.water_entries where user_id = p_user and drunk_on = p_day), 0);
begin
  if v_sum >= v_goal then
    perform public.award_points(p_user, 'water_goal', p_day, 'water_entries', 'water:' || p_day::text);
  else
    perform public.revoke_points(p_user, 'water_entries', 'water:' || p_day::text);
  end if;
end;
$$;

create or replace function public.water_entries_points()
returns trigger language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_water_goal(old.user_id, old.drunk_on);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.drunk_on is distinct from new.drunk_on then
    perform public.sync_water_goal(new.user_id, old.drunk_on);
  end if;
  perform public.sync_water_goal(new.user_id, new.drunk_on);
  return new;
end;
$$;
drop trigger if exists water_entries_points on public.water_entries;
create trigger water_entries_points after insert or update or delete on public.water_entries
  for each row execute function public.water_entries_points();

revoke execute on function public.sleep_entries_guard(), public.sleep_entries_points(), public.water_entries_guard(),
  public.water_entries_points(), public.sync_water_goal(uuid, date)
  from public, anon, authenticated;
