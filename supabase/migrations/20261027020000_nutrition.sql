-- Faz 2, step 3: nutrition (M3) and the AI usage counter for the Gemini food lookup.
--
-- meal_entries: what was eaten, per local day and meal slot. kcal/macros are stored per entry
-- (already multiplied by servings) so a later edit of a saved food never rewrites history.
-- foods: the user's own "frequently eaten" list for one-tap re-entry.
-- Points (docs/PRD.md 1.4, seeded rules): meal_log 5 per entry (max 20/day),
-- protein_goal 15 once per day when the day's protein reaches user_settings.daily_protein_g.
-- Eaten calories are shown next to (never netted with) the workout energy estimate.

create table if not exists public.foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  serving_desc text check (serving_desc is null or char_length(serving_desc) <= 60),
  kcal integer not null check (kcal between 0 and 5000),
  protein_g numeric(6,1) not null default 0 check (protein_g between 0 and 500),
  carb_g numeric(6,1) not null default 0 check (carb_g between 0 and 1000),
  fat_g numeric(6,1) not null default 0 check (fat_g between 0 and 500),
  use_count integer not null default 0 check (use_count >= 0),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists foods_user_name_idx on public.foods (user_id, lower(btrim(name)));
create index if not exists foods_user_recent_idx on public.foods (user_id, last_used_at desc nulls last);

create table if not exists public.meal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  eaten_on date not null,
  meal_slot text not null check (meal_slot in ('breakfast', 'lunch', 'dinner', 'snack')),
  food_id uuid references public.foods(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  servings numeric(5,2) not null default 1 check (servings > 0 and servings <= 20),
  kcal integer not null check (kcal between 0 and 10000),
  protein_g numeric(6,1) not null default 0 check (protein_g between 0 and 1000),
  carb_g numeric(6,1) not null default 0 check (carb_g between 0 and 2000),
  fat_g numeric(6,1) not null default 0 check (fat_g between 0 and 1000),
  source text not null default 'manual' check (source in ('manual', 'food', 'ai_text', 'ai_photo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meal_entries_user_day_idx on public.meal_entries (user_id, eaten_on desc);

-- ai_usage: per-user daily request counter for the AI Edge Function (written only via ai_consume()).
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.foods enable row level security;
alter table public.meal_entries enable row level security;
alter table public.ai_usage enable row level security;

drop policy if exists "foods_owner_all" on public.foods;
create policy "foods_owner_all" on public.foods for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());
drop policy if exists "meal_entries_owner_all" on public.meal_entries;
create policy "meal_entries_owner_all" on public.meal_entries for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());
-- read-only for the owner; increments happen in ai_consume()
drop policy if exists "ai_usage_owner_read" on public.ai_usage;
create policy "ai_usage_owner_read" on public.ai_usage for select to authenticated
  using (user_id = auth.uid() and public.can_access());

drop trigger if exists foods_set_updated_at on public.foods;
create trigger foods_set_updated_at before update on public.foods
  for each row execute function public.set_updated_at();
drop trigger if exists meal_entries_set_updated_at on public.meal_entries;
create trigger meal_entries_set_updated_at before update on public.meal_entries
  for each row execute function public.set_updated_at();

-- No future days; owner never changes; a linked food must belong to the same user.
create or replace function public.meal_entries_guard()
returns trigger language plpgsql set search_path = public set timezone = 'Europe/Istanbul' as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
  end if;
  if new.eaten_on > current_date then
    raise exception 'FUTURE_DATE' using errcode = 'P0001';
  end if;
  if new.food_id is not null and not exists (select 1 from public.foods f where f.id = new.food_id and f.user_id = new.user_id) then
    new.food_id := null;
  end if;
  return new;
end;
$$;
drop trigger if exists meal_entries_guard on public.meal_entries;
create trigger meal_entries_guard before insert or update on public.meal_entries
  for each row execute function public.meal_entries_guard();

-- Protein goal for one day: award when reached, revoke when an edit/delete drops it below.
create or replace function public.sync_protein_goal(p_user uuid, p_day date)
returns void language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_goal integer;
  v_sum numeric;
begin
  select us.daily_protein_g into v_goal from public.user_settings us where us.user_id = p_user;
  select coalesce(sum(me.protein_g), 0) into v_sum from public.meal_entries me where me.user_id = p_user and me.eaten_on = p_day;
  if coalesce(v_goal, 0) > 0 and v_sum >= v_goal then
    perform public.award_points(p_user, 'protein_goal', p_day, 'meal_entries', 'protein:' || p_day::text);
  else
    perform public.revoke_points(p_user, 'meal_entries', 'protein:' || p_day::text);
  end if;
end;
$$;

create or replace function public.meal_entries_points()
returns trigger language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
begin
  if tg_op = 'DELETE' then
    perform public.revoke_points(old.user_id, 'meal_entries', old.id::text);
    perform public.sync_protein_goal(old.user_id, old.eaten_on);
    return old;
  end if;
  if tg_op = 'INSERT' then
    perform public.award_points(new.user_id, 'meal_log', new.eaten_on, 'meal_entries', new.id::text);
  elsif old.eaten_on is distinct from new.eaten_on then
    -- moved to another day: the meal point follows the original day only (no re-award), protein re-evaluated on both
    perform public.sync_protein_goal(new.user_id, old.eaten_on);
  end if;
  perform public.sync_protein_goal(new.user_id, new.eaten_on);
  return new;
end;
$$;
drop trigger if exists meal_entries_points on public.meal_entries;
create trigger meal_entries_points after insert or update or delete on public.meal_entries
  for each row execute function public.meal_entries_points();

-- ---------------------------------------------------------------------------------------------
-- AI quota. Called by the Edge Function with the caller's JWT (never service_role): counts one
-- request against the caller's daily limit (user_settings.ai_daily_limit) and the global limit
-- (app_config.ai_global_daily_limit, protects the shared free Gemini quota).
-- Returns the remaining requests for today, or raises AI_QUOTA.
create or replace function public.ai_consume()
returns integer language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_user uuid := auth.uid();
  v_limit integer;
  v_global integer := coalesce((select (value #>> '{}')::int from public.app_config where key = 'ai_global_daily_limit'), 200);
  v_used integer;
  v_all integer;
begin
  if v_user is null or not public.can_access() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select us.ai_daily_limit into v_limit from public.user_settings us where us.user_id = v_user;
  v_limit := coalesce(v_limit, 40);

  insert into public.ai_usage (user_id, day, request_count) values (v_user, current_date, 0)
  on conflict (user_id, day) do nothing;
  select request_count into v_used from public.ai_usage where user_id = v_user and day = current_date for update;
  select coalesce(sum(request_count), 0) into v_all from public.ai_usage where day = current_date;
  if v_used >= v_limit or v_all >= v_global then
    raise exception 'AI_QUOTA' using errcode = 'P0001';
  end if;
  update public.ai_usage set request_count = request_count + 1, updated_at = now() where user_id = v_user and day = current_date;
  return v_limit - v_used - 1;
end;
$$;
revoke execute on function public.ai_consume() from public, anon;
grant execute on function public.ai_consume() to authenticated;

revoke execute on function public.meal_entries_guard(), public.meal_entries_points(), public.sync_protein_goal(uuid, date)
  from public, anon, authenticated;
