-- Deleting activity must also roll back the streak. Before this, revoke_points() only subtracted points,
-- so logging a workout and deleting it kept the day as "active" (streak could be inflated for free).
-- Now the streak is rebuilt from the remaining scoring days. longest_streak is never lowered: it only
-- ever counted days that really had activity at the time.

create or replace function public.recompute_streak(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_last date;
  v_streak integer;
begin
  select max(occurred_on) into v_last
  from public.point_events
  where user_id = p_user and points > 0;

  if v_last is null then
    v_streak := 0;
  else
    -- consecutive scoring days ending at v_last (gaps-and-islands)
    with days as (
      select distinct occurred_on as d from public.point_events where user_id = p_user and points > 0
    ),
    grouped as (
      select d, d - (row_number() over (order by d))::int as grp from days
    )
    select count(*) into v_streak from grouped
    where grp = (select grp from grouped where d = v_last);
  end if;

  perform set_config('app.internal', 'on', true);
  update public.profiles
     set current_streak = v_streak,
         last_active_on = v_last,
         longest_streak = greatest(longest_streak, v_streak)
   where user_id = p_user;
  perform set_config('app.internal', 'off', true);
end;
$$;
revoke execute on function public.recompute_streak(uuid) from public, anon, authenticated;
grant execute on function public.recompute_streak(uuid) to service_role;

create or replace function public.revoke_points(p_user uuid, p_ref_table text, p_ref_id text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  removed integer;
  rows_deleted integer;
begin
  with d as (
    delete from public.point_events
    where user_id = p_user and ref_table = p_ref_table and ref_id = p_ref_id
    returning points
  ) select coalesce(sum(points), 0), count(*) into removed, rows_deleted from d;

  if rows_deleted > 0 then
    perform set_config('app.internal', 'on', true);
    update public.profiles set total_points = greatest(total_points - removed, 0) where user_id = p_user;
    perform set_config('app.internal', 'off', true);
    perform public.recompute_streak(p_user);
  end if;
  return removed;
end;
$$;
revoke execute on function public.revoke_points(uuid, text, text) from public, anon, authenticated;
grant execute on function public.revoke_points(uuid, text, text) to service_role;
