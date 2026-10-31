-- Admin: free-tier usage summary (Profile > Admin > Free tier). Database and storage size, users, and
-- an estimate of this month's Edge Function calls: AI requests (ai_usage_log) plus delivered reminders
-- (private.reminder_log). Supabase does not expose invocation counts to SQL, so other calls (food
-- search, push setup) are not counted; the UI says "estimate". Limits live in the UI (README table).
create or replace function public.admin_usage_summary()
returns jsonb language plpgsql stable security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_month_start timestamptz := date_trunc('month', now());
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'storage', coalesce((
      select jsonb_object_agg(bucket_id, bytes)
      from (select o.bucket_id, sum(coalesce((o.metadata ->> 'size')::bigint, 0)) as bytes
            from storage.objects o group by o.bucket_id) b), '{}'::jsonb),
    'users_total', (select count(*) from public.profiles where onboarding_completed_at is not null),
    'users_active_7d', (select count(*) from public.profiles where last_active_on >= current_date - 6),
    'ai_calls_month', (select count(*) from public.ai_usage_log where created_at >= v_month_start),
    'push_month', (select count(*) from private.reminder_log where sent_at >= v_month_start),
    'month_start', v_month_start
  );
end;
$$;
revoke execute on function public.admin_usage_summary() from public, anon;
grant execute on function public.admin_usage_summary() to authenticated;
