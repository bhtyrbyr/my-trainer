-- SECURITY FIX (found by the pgTAP suite): Supabase grants EXECUTE on every new public function to
-- anon and authenticated via default privileges; "revoke ... from public" does not remove those grants.
-- That made award_points()/revoke_points() callable by any signed-in user (point tampering).
-- Production check before this fix: 0 point_events, 0 total points -> not exploited.

-- 1) Internal helpers: nobody but the owner/service_role may call them directly.
--    (Trigger functions keep firing: EXECUTE is only checked when a trigger is created.)
revoke execute on function public.award_points(uuid, text, date, text, text, integer) from public, anon, authenticated;
revoke execute on function public.revoke_points(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.enforce_access_mode() from public, anon, authenticated;
revoke execute on function public.protect_profile_columns() from public, anon, authenticated;
revoke execute on function public.workout_sessions_revoke_points() from public, anon, authenticated;
revoke execute on function public.personal_records_revoke_points() from public, anon, authenticated;
grant execute on function public.award_points(uuid, text, date, text, text, integer) to service_role;
grant execute on function public.revoke_points(uuid, text, text) to service_role;

-- 2) Signed-in RPCs: never callable anonymously (each also checks the caller internally).
revoke execute on function public.admin_list_registrations(text, integer) from anon;
revoke execute on function public.admin_set_registration_status(uuid, text) from anon;
revoke execute on function public.admin_pending_count() from anon;
revoke execute on function public.admin_delete_rejected_user(uuid) from anon;
revoke execute on function public.delete_my_account() from anon;
revoke execute on function public.can_access() from anon;
revoke execute on function public.has_onboarded() from anon;
revoke execute on function public.is_admin() from anon;

-- 3) Defence in depth: future functions created by the migration owner are NOT executable by
--    anon/authenticated unless a migration grants it explicitly.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
