-- Leaderboard rows expose the (public) effective streak so avatars can show the streak frame.
-- Effective streak: current_streak only while the user was active today or yesterday; otherwise 0.

create or replace function public.effective_streak(p_current integer, p_last_active date)
returns integer language sql immutable as $$
  select case when p_last_active is not null and p_last_active >= current_date - 1 then coalesce(p_current, 0) else 0 end
$$;
grant execute on function public.effective_streak(integer, date) to authenticated, service_role;

drop function if exists public.get_leaderboard(text, integer);
create function public.get_leaderboard(p_period text default 'week', p_limit integer default 50)
returns table (
  rank bigint, user_id uuid, username text, display_name text, avatar_path text,
  points bigint, level integer, active_days bigint, streak integer, is_me boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  d_from date;
  d_to date := current_date + 1;
begin
  if not public.can_access() then return; end if;
  d_from := case p_period
    when 'week'  then date_trunc('week', current_date)::date
    when 'month' then date_trunc('month', current_date)::date
    else date '1970-01-01'
  end;
  return query
  with scores as (
    select e.user_id, sum(e.points)::bigint as points, count(distinct e.occurred_on)::bigint as active_days
    from public.point_events e
    where e.occurred_on >= d_from and e.occurred_on < d_to
    group by e.user_id
  ),
  ranked as (
    select
      dense_rank() over (order by s.points desc, p.created_at asc) as rank,
      p.user_id, p.username::text, p.display_name, p.avatar_path, s.points, p.level, s.active_days,
      public.effective_streak(p.current_streak, p.last_active_on) as streak,
      (p.user_id = auth.uid()) as is_me
    from scores s
    join public.profiles p on p.user_id = s.user_id
    where p.show_on_leaderboard and not p.is_blocked and p.status = 'approved' and p.onboarding_completed_at is not null
  )
  select * from ranked r where r.rank <= p_limit or r.is_me
  order by r.rank, r.display_name
  limit p_limit + 1;
end;
$$;
revoke all on function public.get_leaderboard(text, integer) from public, anon;
grant execute on function public.get_leaderboard(text, integer) to authenticated;
