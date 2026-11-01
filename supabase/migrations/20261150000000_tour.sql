-- First-run product tour: null = the user has not finished (or skipped) the tour yet.
-- The owner writes it through the existing user_settings_owner_all policy; user_settings_protect only
-- pins ai_daily_limit, so this column needs no extra guard.
alter table public.user_settings add column if not exists tour_completed_at timestamptz;

-- Existing users already know the app: do not interrupt them with the tour after this release.
update public.user_settings set tour_completed_at = now() where tour_completed_at is null;
