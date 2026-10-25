-- Seed (run once in the Supabase SQL editor, or applied automatically by `npx supabase db reset` locally).
--
-- 1. Which Google account becomes the first admin? That account gets role = 'admin' when it completes onboarding.
--    (If left empty, the very first profile created becomes admin.)
update public.app_config
   set value = to_jsonb('replace_with_your_google_email@gmail.com'::text), updated_at = now()
 where key = 'admin_bootstrap_email';

-- 2. Access mode: 'open' = anyone with a Google account may sign up (default); 'invite' = only allowed_emails.
update public.app_config set value = '"open"'::jsonb, updated_at = now() where key = 'access_mode';

-- 3. Optional invite list (only used when access_mode = 'invite'):
-- insert into public.allowed_emails (email, note) values ('friend@gmail.com', 'friend') on conflict do nothing;
