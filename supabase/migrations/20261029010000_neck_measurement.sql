-- Neck circumference, needed for the U.S. Navy body-fat estimate (Hodgdon & Beckett 1984), which the
-- body page computes from height, neck, waist (and hips for women). Counts as a measurement for points.
alter table public.body_metrics
  add column if not exists neck_cm numeric(5,1) check (neck_cm is null or neck_cm between 20 and 80);

create or replace function public.body_metrics_points()
returns trigger language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_had_measure boolean;
  v_has_measure boolean;
begin
  if tg_op = 'DELETE' then
    perform public.revoke_points(old.user_id, 'body_metrics', old.id::text || ':w');
    perform public.revoke_points(old.user_id, 'body_metrics', old.id::text || ':m');
    return old;
  end if;

  if new.weight_kg is not null then
    perform public.award_points(new.user_id, 'weight_log', new.measured_on, 'body_metrics', new.id::text || ':w');
  elsif tg_op = 'UPDATE' and old.weight_kg is not null then
    perform public.revoke_points(new.user_id, 'body_metrics', new.id::text || ':w');
  end if;

  v_has_measure := coalesce(new.waist_cm, new.chest_cm, new.arm_cm, new.hip_cm, new.thigh_cm, new.neck_cm) is not null;
  v_had_measure := tg_op = 'UPDATE' and coalesce(old.waist_cm, old.chest_cm, old.arm_cm, old.hip_cm, old.thigh_cm, old.neck_cm) is not null;
  if v_has_measure then
    perform public.award_points(new.user_id, 'measurement_log', new.measured_on, 'body_metrics', new.id::text || ':m');
  elsif v_had_measure then
    perform public.revoke_points(new.user_id, 'body_metrics', new.id::text || ':m');
  end if;
  return new;
end;
$$;
revoke execute on function public.body_metrics_points() from public, anon, authenticated;
