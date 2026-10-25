-- Optional starting weight captured during onboarding. In Faz 2 the body_metrics module
-- will copy this into the first body_metrics row (if the user has none yet).
alter table public.profile_private
  add column if not exists start_weight_kg numeric(5,1)
  check (start_weight_kg is null or start_weight_kg between 20 and 400);
