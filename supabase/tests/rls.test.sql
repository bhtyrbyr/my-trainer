-- pgTAP suite (RLS, anti-IDOR, points, approval, workouts). Runs in CI before every deploy
-- (.github/workflows/ci.yml job "db-tests"); locally: npx supabase start && npx supabase test db
begin;
-- The app's calendar day is Europe/Istanbul (points, streaks, weeks): test in the same zone so the
-- suite does not depend on the hour it runs (UTC and Istanbul dates differ 21:00-24:00 UTC).
set local timezone = 'Europe/Istanbul';
create extension if not exists pgtap with schema extensions;
select plan(759);

-- Deterministic config regardless of seed.sql (the seed sets a real admin email)
-- Alice is the configured admin (independent of whatever profiles already exist in the database)
update public.app_config set value = '"alice@example.com"'::jsonb where key = 'admin_bootstrap_email';
update public.app_config set value = '"open"'::jsonb where key = 'access_mode';
update public.app_config set value = 'true'::jsonb where key = 'require_approval';

-- Function privileges: security-definer functions are an allow-list, never a default ------------
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')
      -- prune_push_subscriptions: the push-send Edge Function has no user JWT and no service_role, so
      -- it calls this with the anon key; the shared dispatch secret is checked inside (FORBIDDEN).
      and p.proname not in ('rls_auto_enable', 'prune_push_subscriptions')),
  '{}'::text[],
  'anon cannot execute any security-definer function'
);
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname not in (
        'admin_delete_rejected_user', 'admin_list_registrations', 'admin_pending_count',
        'admin_ai_app_today', 'admin_ai_live', 'admin_ai_usage', 'admin_error_reports', 'admin_set_registration_status', 'ai_availability', 'ai_log_usage', 'ai_reserve', 'can_access', 'delete_my_account', 'finish_workout_session',
        'get_leaderboard', 'has_health_consent', 'withdraw_ai_consent', 'has_onboarded', 'is_admin', 'progress_photo_object_count', 'prune_push_subscriptions', 'record_consent',
        'register_push', 'rls_auto_enable', 'unregister_push', 'withdraw_health_consent',
        -- Faz 4
        'get_user_badges', 'admin_set_config', 'admin_list_allowed_emails', 'admin_add_allowed_email',
        'admin_remove_allowed_email', 'admin_list_users', 'admin_set_blocked', 'admin_set_ai_limit',
        'ai_add_assistant_message',
        -- Faz 5
        'admin_usage_summary', 'my_badge_progress',
        -- security hardening (20261120000000); can_onboard/progress_photo_bytes are RLS policy helpers
        'can_onboard', 'get_public_profile', 'is_username_available', 'progress_photo_bytes',
        -- social (20261140000000); can_view_post/can_view_profile/social_media_* are also policy helpers
        'can_view_post', 'can_view_profile', 'social_media_readable', 'social_media_upload_ok', 'social_media_attach_ok',
        'social_enable', 'social_disable', 'social_update_settings', 'social_follow', 'social_respond_follow',
        'social_unfollow', 'social_remove_follower', 'social_follow_requests', 'social_block', 'social_unblock',
        'social_blocked_users', 'social_create_post', 'social_delete_post', 'social_set_audience', 'social_like',
        'social_unlike', 'social_feed', 'social_discover', 'social_user_posts', 'social_group_posts', 'social_post',
        'social_profile', 'social_search_users', 'social_followers', 'social_following', 'social_notifications_list',
        'social_unread_count', 'social_mark_read', 'group_create', 'group_update', 'group_join', 'group_join_by_code',
        'group_invite', 'group_respond', 'group_set_role', 'group_remove_member', 'group_leave', 'group_rotate_code',
        'group_delete', 'social_my_groups', 'social_group', 'social_search_groups', 'social_group_members',
        'social_report', 'admin_list_reports', 'admin_resolve_report', 'admin_remove_post',
        -- social hardening (20261160000000)
        'group_unban', 'group_bans_list',
        -- hashtags (20261170000000)
        'social_tag_posts', 'social_search_tags',
        -- mentions (20261180000000)
        'social_remove_mention', 'social_mention_candidates', 'social_mentioned_posts')),
  '{}'::text[],
  'authenticated can execute only the allow-listed security-definer RPCs'
);

select is((select value from public.app_config where key = 'ai_global_daily_limit'), '450'::jsonb, 'ai: the app-wide daily AI budget is 450');

-- Fixtures ------------------------------------------------------------------
\set ua '00000000-0000-0000-0000-00000000000a'
\set ub '00000000-0000-0000-0000-00000000000b'

insert into auth.users (id, email, instance_id, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  (:'ua', 'alice@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}', '{}', now(), now()),
  (:'ub', 'bob@example.com',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}', '{}', now(), now());

-- 1-2. settings rows auto-created
select is((select count(*)::int from public.user_settings where user_id = :'ua'), 1, 'alice settings auto-created');
select is((select count(*)::int from public.user_settings where user_id = :'ub'), 1, 'bob settings auto-created');

-- Alice onboards -------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
insert into public.profiles (user_id, username, display_name, avatar_path, onboarding_completed_at, role, total_points)
values (:'ua', 'Alice_01', 'Alice', '00000000-0000-0000-0000-00000000000a/avatar.jpg', now(), 'admin', 9999);

-- 3-5. column protection on insert
select is((select username::text from public.profiles where user_id = :'ua'), 'alice_01', 'username lower-cased');
select is((select total_points from public.profiles where user_id = :'ua'), 0, 'client cannot seed points');
select is((select role from public.profiles where user_id = :'ua'), 'admin', 'bootstrap email becomes admin');

-- 6. client cannot award itself points (no insert policy)
select throws_ok(
  $$ insert into public.point_events (user_id, kind, points, occurred_on, ref_table, ref_id)
     values ('00000000-0000-0000-0000-00000000000a', 'weight_log', 10, current_date, 't', '1') $$,
  '42501', null, 'client insert into point_events is denied by RLS'
);

-- 7. client cannot call award_points directly
select throws_ok(
  $$ select public.award_points('00000000-0000-0000-0000-00000000000a', 'weight_log', current_date, 't', '1') $$,
  '42501', null, 'authenticated role cannot execute award_points'
);

-- Bob onboards (starts as pending: require_approval = true) --------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
insert into public.profiles (user_id, username, display_name, avatar_path, onboarding_completed_at)
values (:'ub', 'bob', 'Bob', '00000000-0000-0000-0000-00000000000b/avatar.jpg', now());
select is((select status from public.profiles where user_id = :'ub'), 'pending', 'new non-admin profile is pending');
select is((select count(*)::int from public.profiles), 1, 'pending bob sees only his own profile');
select lives_ok(
  $$ insert into public.profile_private (user_id, height_cm) values ('00000000-0000-0000-0000-00000000000b', 180)
     on conflict (user_id) do update set height_cm = excluded.height_cm $$,
  'onboarding: pending bob may still upsert his profile_private (retry)'
);
update public.user_settings set locale = 'en' where user_id = :'ub';
select is((select count(*)::int from public.user_settings), 0, 'pending bob cannot read or write other tables');
select ok(not public.can_access() and public.can_onboard(), 'pending: can_access false, can_onboard true');
select throws_ok(
  $$ select public.admin_set_registration_status('00000000-0000-0000-0000-00000000000b', 'approved') $$,
  '42501', null, 'non-admin cannot approve'
);
-- Alice (admin) approves Bob
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select is((select count(*)::int from public.admin_list_registrations('pending')), 1, 'admin sees bob in pending list');
select lives_ok(
  $$ select public.admin_set_registration_status('00000000-0000-0000-0000-00000000000b', 'approved') $$,
  'admin approves bob'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
select ok(public.can_access(), 'approved bob can access');
update public.profile_private set height_cm = 180 where user_id = :'ub';

-- 8. bob cannot escalate himself
update public.profiles set role = 'admin', is_blocked = false, total_points = 500 where user_id = :'ub';
select is((select role || ':' || total_points from public.profiles where user_id = :'ub'), 'user:0', 'bob cannot change role or points');

-- 9-10. isolation: bob sees alice's PUBLIC profile but not her private rows / settings
select is((select count(*)::int from public.profiles), 1, 'profiles: other users'' rows are not readable directly');
select is((select username from public.get_public_profile(:'ua')), 'alice_01', 'get_public_profile returns a visible user''s public fields');
select ok(not public.is_username_available('alice_01') and public.is_username_available('BOB') and public.is_username_available('free_name'),
  'is_username_available: taken by others false, own and free true');
select is((select count(*)::int from public.user_settings where user_id = :'ua'), 0, 'bob cannot read alice settings');

-- IDOR attempts: bob tampers with user_id in filters / bodies ------------------
select is((select count(*)::int from public.profile_private where user_id = :'ua'), 0, 'IDOR read: bob gets zero private rows for alice');
select throws_ok(
  $$ insert into public.user_settings (user_id, locale) values ('00000000-0000-0000-0000-00000000000a', 'en') $$,
  '42501', null, 'IDOR write: bob cannot insert a row owned by alice'
);
update public.profiles set display_name = 'HACKED' where user_id = :'ua';
select is((select display_name from public.get_public_profile(:'ua')), 'Alice', 'IDOR update: bob cannot change alice profile');
delete from public.profile_private where user_id = :'ua';
reset role;
select is((select count(*)::int from public.profile_private where user_id = :'ua'), 0, 'IDOR delete: no-op (alice has no private row yet, and bob could not have touched it)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';

-- Points engine (as the function owner / service role) ------------------------
reset role;
select is(public.award_points(:'ub', 'weight_log', current_date, 'body_metrics', 'x1'), 10, 'weight log awards 10');
select is(public.award_points(:'ub', 'weight_log', current_date, 'body_metrics', 'x2'), 0, 'second weight log same day capped to 0');
select is((select total_points from public.profiles where user_id = :'ub'), 10, 'profile total updated');

-- 14. leaderboard returns only public fields and includes bob
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select is((select count(*)::int from public.get_leaderboard('week', 50) where username = 'bob' and points = 10), 1, 'leaderboard lists bob with 10 points');

-- =============================================================================
-- Faz 1: exercise catalog, workouts, PRs, points integration
-- =============================================================================
\set ex1 '00000000-0000-0000-0000-0000000000e1'
\set ex2 '00000000-0000-0000-0000-0000000000e2'
\set ex3 '00000000-0000-0000-0000-0000000000e3'
\set s1  '00000000-0000-0000-0000-0000000000a1'
\set s2  '00000000-0000-0000-0000-0000000000a2'
\set s3  '00000000-0000-0000-0000-0000000000a3'
\set s4  '00000000-0000-0000-0000-0000000000a4'
\set s5  '00000000-0000-0000-0000-0000000000a5'
\set se5 '00000000-0000-0000-0000-0000000000b5'
\set sa1 '00000000-0000-0000-0000-0000000000f1'
\set se1 '00000000-0000-0000-0000-0000000000b1'
\set se2 '00000000-0000-0000-0000-0000000000b2'
\set se3 '00000000-0000-0000-0000-0000000000b3'

-- Catalog seeded server-side (service_role / postgres: no JWT -> not forced to custom)
reset role;
set local request.jwt.claims = '';
insert into public.exercises (id, external_id, name_en, body_parts, target_muscles, equipment) values
  (:'ex1', 'edb-0001', 'Barbell Bench Press', '{chest}', '{pectorals}', '{barbell}'),
  (:'ex2', 'edb-0002', 'Barbell Squat', '{upper legs}', '{quads}', '{barbell}');
select is((select count(*)::int from public.exercises where not is_custom and user_id is null), 2, 'catalog insert without JWT stays catalog');
-- Alice owns one session (used for IDOR checks)
insert into public.workout_sessions (id, user_id, kind, title) values (:'sa1', :'ua', 'strength', 'Alice session');
create temp table t_finish (label text primary key, r jsonb);
grant all on t_finish to authenticated;

-- Bob: catalog is read-only, custom exercises are forced ----------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
select is((select count(*)::int from public.exercises), 2, 'bob reads the catalog');
update public.exercises set name_en = 'HACKED' where id = :'ex1';
select is((select name_en from public.exercises where id = :'ex1'), 'Barbell Bench Press', 'catalog exercise update affects 0 rows');
delete from public.exercises where id = :'ex1';
select is((select count(*)::int from public.exercises where not is_custom), 2, 'catalog exercise delete affects 0 rows');
insert into public.exercises (id, external_id, source, name_en, is_custom, user_id, media_frames)
values (:'ex3', 'fake-ext', 'wger', 'My Cable Curl', false, :'ub', '{frames/x/1.svg}');
select is(
  (select is_custom::text || ':' || source || ':' || coalesce(external_id, 'null') || ':' || cardinality(media_frames) || ':' || user_id::text
     from public.exercises where id = :'ex3'),
  'true:custom:null:0:00000000-0000-0000-0000-00000000000b',
  'custom exercise is forced to is_custom/source=custom/external_id=null/owner'
);
select is((select count(*)::int from public.exercises), 3, 'bob sees catalog + his custom exercise');

-- IDOR: bob cannot attach a session_exercise to alice's session -----------------
select throws_ok(
  $$ insert into public.session_exercises (session_id, user_id, exercise_id, position)
     values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000e1', 1) $$,
  '42501', null, 'IDOR: child row referencing another user''s session is rejected'
);
select throws_ok(
  $$ insert into public.workout_sessions (user_id, kind) values ('00000000-0000-0000-0000-00000000000a', 'strength') $$,
  '42501', null, 'IDOR: bob cannot insert a session owned by alice'
);

-- Strength session s1: 1 warmup + 3 working sets -------------------------------
insert into public.workout_sessions (id, user_id, kind, title, started_at)
values (:'s1', :'ub', 'strength', 'Push A', greatest(now() - interval '45 minutes', date_trunc('day', now())));
insert into public.session_exercises (id, session_id, user_id, exercise_id, position) values (:'se1', :'s1', :'ub', :'ex1', 1);
insert into public.session_sets (session_exercise_id, session_id, user_id, set_no, weight_kg, reps, is_warmup) values
  (:'se1', :'s1', :'ub', 1, 60, 10, true),
  (:'se1', :'s1', :'ub', 2, 100, 5, false),
  (:'se1', :'s1', :'ub', 3, 100, 5, false),
  (:'se1', :'s1', :'ub', 4, 102.5, 3, false);
select is((select count(*)::int from public.session_sets where session_id = :'s1'), 4, 'owner inserted 4 sets');
insert into t_finish select 's1', public.finish_workout_session(:'s1');
select is((select (r->>'total_sets')::int from t_finish where label = 's1'), 3, 'finish: warmups excluded from total_sets');
select is((select (r->>'total_volume_kg')::numeric from t_finish where label = 's1'), 1307.5::numeric, 'finish: total volume');
select is((select (r->>'points_awarded')::int from t_finish where label = 's1'), 56, 'finish: 50 + 2*3 session points; first log earns no PR points');
select is((select jsonb_array_length(r->'new_prs') from t_finish where label = 's1'), 0, 'finish: first log is a baseline, not an announced PR');
select throws_like($$ select public.finish_workout_session('00000000-0000-0000-0000-0000000000a1') $$, '%ALREADY_FINISHED%', 'a finished session cannot be finished again');
select ok((select ended_at is not null and duration_sec = floor(extract(epoch from (now() - started_at)))::int from public.workout_sessions where id = :'s1'), 'finish: session closed with wall-clock duration');
select is((select points from public.point_events where user_id = :'ub' and ref_table = 'workout_sessions' and ref_id = :'s1'), 56, 'point_events: strength session row');
select is((select count(*)::int from public.point_events where user_id = :'ub' and ref_table = 'personal_records'), 0, 'no PR point event for a baseline');
select is((select total_points from public.profiles where user_id = :'ub'), 66, 'profile total = 10 + 56');
-- energy estimate: RPE not logged -> MET 5.0 x 70 kg default x hours (45 min = 263 kcal)
select is(
  (select kcal_estimate from public.workout_sessions where id = :'s1'),
  (select case when duration_sec < 60 then null else round(5.0 * 70 * duration_sec / 3600.0)::int end from public.workout_sessions where id = :'s1'),
  'kcal: strength estimate with default weight (MET 5.0 x 70 kg x hours)'
);
select ok((select kcal_weight_kg is null from public.workout_sessions where id = :'s1'), 'kcal: default weight is flagged as assumed');
select is((select e1rm from public.personal_records where user_id = :'ub' and exercise_id = :'ex1'), 116.67::numeric, 'personal_records row stored');

-- s2: equal e1rm -> no PR --------------------------------------------------------
insert into public.workout_sessions (id, user_id, kind, started_at) values (:'s2', :'ub', 'strength', greatest(now() - interval '30 minutes', date_trunc('day', now())));
insert into public.session_exercises (id, session_id, user_id, exercise_id, position) values (:'se2', :'s2', :'ub', :'ex1', 1);
insert into public.session_sets (session_exercise_id, session_id, user_id, set_no, weight_kg, reps) values (:'se2', :'s2', :'ub', 1, 100, 5);
insert into t_finish select 's2', public.finish_workout_session(:'s2');
select is((select jsonb_array_length(r->'new_prs') from t_finish where label = 's2'), 0, 'equal e1rm is not a PR');
select is((select (r->>'points_awarded')::int from t_finish where label = 's2'), 0, 'a single working set earns no session points (minimum 3)');
select is((select count(*)::int from public.personal_records where user_id = :'ub'), 1, 'still one PR row');

-- s3: higher e1rm -> PR, same day -> row upserted, no second PR points -------------
insert into public.workout_sessions (id, user_id, kind, started_at) values (:'s3', :'ub', 'strength', greatest(now() - interval '10 minutes', date_trunc('day', now())));
insert into public.session_exercises (id, session_id, user_id, exercise_id, position) values (:'se3', :'s3', :'ub', :'ex1', 1);
insert into public.session_sets (session_exercise_id, session_id, user_id, set_no, weight_kg, reps) values (:'se3', :'s3', :'ub', 1, 110, 5);
insert into t_finish select 's3', public.finish_workout_session(:'s3');
select is((select jsonb_array_length(r->'new_prs') from t_finish where label = 's3'), 1, 'higher e1rm is a PR');
select is((select e1rm from public.personal_records where user_id = :'ub' and exercise_id = :'ex1'), 128.33::numeric, 'PR row updated to the new best');
select is((select count(*)::int from public.personal_records where user_id = :'ub'), 1, 'one PR row per exercise per day');
select is((select (r->>'points_awarded')::int from t_finish where label = 's3'), 20, 'real PR earns 20 (single set: no session points)');
select is((select total_points from public.profiles where user_id = :'ub'), 86, 'profile total after three sessions');

-- s4: cardio -------------------------------------------------------------------------
insert into public.workout_sessions (id, user_id, kind, started_at) values (:'s4', :'ub', 'cardio', greatest(now() - interval '5 minutes', date_trunc('day', now())));
insert into public.cardio_entries (session_id, user_id, activity, duration_sec, distance_m) values (:'s4', :'ub', 'run', 1800, 5000);
insert into t_finish select 's4', public.finish_workout_session(:'s4');
select is((select (r->>'duration_sec')::int from t_finish where label = 's4'), 1800, 'cardio duration taken from cardio_entries');
select is((select (r->>'points_awarded')::int from t_finish where label = 's4'), 36, 'cardio: 30 + floor(1800/300)');
-- 5 km in 30 min = 10 km/h -> MET 9.8 x 70 x 0.5 h = 343
select is((select kcal_estimate from public.workout_sessions where id = :'s4'), 343, 'kcal: cardio estimate from activity + speed');
select is((select points from public.point_events where user_id = :'ub' and ref_table = 'personal_records' and ref_id = :'ex1' || ':' || (now() at time zone 'Europe/Istanbul')::date::text), 20, 'PR point event keyed exercise:local date');
-- clients cannot rewrite server-owned session columns or delete PRs
update public.workout_sessions set kind = 'cardio', ended_at = null, total_sets = 99 where id = :'s3';
select ok((select kind = 'strength' and ended_at is not null and total_sets = 1 from public.workout_sessions where id = :'s3'), 'client update of kind/ended_at/totals is ignored');
update public.workout_sessions set kcal_estimate = 9999, kcal_weight_kg = 50 where id = :'s3';
select ok((select kcal_estimate is distinct from 9999 and kcal_weight_kg is null from public.workout_sessions where id = :'s3'), 'client cannot rewrite the kcal estimate');
delete from public.personal_records where user_id = :'ub';
select is((select count(*)::int from public.personal_records where user_id = :'ub'), 1, 'client cannot delete personal_records');

-- Clients never write PRs or points directly ------------------------------------------
select throws_ok(
  $$ insert into public.personal_records (user_id, exercise_id, e1rm, achieved_on)
     values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000e2', 999, current_date) $$,
  '42501', null, 'client cannot insert personal_records'
);
update public.profiles set total_points = 100000 where user_id = :'ub';
select is((select total_points from public.profiles where user_id = :'ub'), 122, 'client cannot edit total_points');

-- Read RPCs -------------------------------------------------------------------------
select is((select count(*)::int from public.last_sets_for_exercise(:'ex1', 1)), 1, 'last_sets_for_exercise(limit 1) returns the latest session''s sets');
select is((select count(*)::int from public.last_sets_for_exercise(:'ex1', 3)), 6, 'last_sets_for_exercise(limit 3) spans three sessions');
-- A newer finished session that lists the exercise but logged no sets must not hide the real "last time"
insert into public.workout_sessions (id, user_id, kind, started_at) values (:'s5', :'ub', 'strength', greatest(now() - interval '2 minutes', date_trunc('day', now())));
insert into public.session_exercises (id, session_id, user_id, exercise_id, position) values (:'se5', :'s5', :'ub', :'ex1', 1);
select public.finish_workout_session(:'s5');
select is(
  (select weight_kg from public.last_sets_for_exercise(:'ex1', 1) limit 1),
  110::numeric, 'last_sets_for_exercise skips sessions with no sets for the exercise'
);
-- Calendar-day functions run on Turkish local time, not UTC
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('award_points', 'finish_workout_session', 'get_leaderboard', 'todays_templates', 'effective_streak')
      and 'TimeZone=Europe/Istanbul' = any (p.proconfig)),
  5, 'date-deriving functions use Europe/Istanbul'
);
select is((select count(*)::int from public.exercise_progress(:'ex1')), 3, 'exercise_progress: one row per finished session');
select is((select max(best_e1rm) from public.exercise_progress(:'ex1')), 128.33::numeric, 'exercise_progress: best e1rm');
select is(
  (select avg_weight_kg from public.exercise_progress(:'ex1') order by started_at limit 1),
  100.83::numeric, 'exercise_progress: average working weight per session (warmup excluded)'
);

-- Day-based plans -------------------------------------------------------------------
insert into public.workout_templates (user_id, name, weekdays) values (:'ub', 'Push (Mon/Wed)', '{1,3}');
select is((select count(*)::int from public.todays_templates(1)), 1, 'todays_templates: Monday plan found');
select is((select count(*)::int from public.todays_templates(2)), 0, 'todays_templates: nothing planned on Tuesday');
select throws_ok(
  $$ insert into public.workout_templates (user_id, name, weekdays) values ('00000000-0000-0000-0000-00000000000b', 'bad', '{8}') $$,
  '23514', null, 'weekdays must be ISO 1..7'
);

-- Alice sees none of bob's workout data -----------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select is((select count(*)::int from public.exercises), 2, 'alice does not see bob''s custom exercise');
select is((select count(*)::int from public.workout_sessions where user_id = :'ub'), 0, 'alice sees zero of bob''s sessions');
select is((select count(*)::int from public.session_sets), 0, 'alice sees zero of bob''s sets');
select is((select count(*)::int from public.todays_templates(1)), 0, 'alice does not get bob''s day plan');
select is((select count(*)::int from public.personal_records), 0, 'alice sees zero of bob''s PRs');
select is((select count(*)::int from public.point_events where user_id = :'ub'), 0, 'alice sees zero of bob''s point events');
select is((select count(*)::int from public.last_sets_for_exercise(:'ex1', 5)), 0, 'RPC last_sets_for_exercise is scoped to the caller');
select throws_ok(
  $$ select public.finish_workout_session('00000000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'alice cannot finish bob''s session'
);
delete from public.workout_sessions where id = :'s1';
select is((select count(*)::int from public.point_events where user_id = :'ub' and ref_id = :'s1'), 0, 'alice delete of bob''s session is a no-op (she cannot see the event either)');

-- Deleting a session revokes its points; cascading PR delete revokes PR points -----------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
select is((select count(*)::int from public.workout_sessions where id = :'s1'), 1, 'bob''s session survived alice''s delete attempt');
delete from public.workout_sessions where id = :'s1';
select is((select count(*)::int from public.point_events where user_id = :'ub' and ref_table = 'workout_sessions' and ref_id = :'s1'), 0, 'deleting the session removes its point event');
select is((select total_points from public.profiles where user_id = :'ub'), 66, 'session points revoked (122 - 56)');
select is((select count(*)::int from public.personal_records where user_id = :'ub'), 1, 'PR row survives (it now points at s3''s set)');
delete from public.workout_sessions where id = :'s3';
select is((select count(*)::int from public.personal_records where user_id = :'ub'), 0, 'PR row cascaded with its set');
select is((select count(*)::int from public.point_events where user_id = :'ub' and ref_table = 'personal_records'), 0, 'PR point event revoked by cascade');
select is((select total_points from public.profiles where user_id = :'ub'), 46, 'PR points revoked with the cascade (66 - 20)');

-- Deleting the only scoring activity of the day also rolls the streak back --------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
insert into public.workout_sessions (id, user_id, kind, started_at)
  values ('00000000-0000-0000-0000-0000000000a6', :'ua', 'strength', greatest(now() - interval '20 minutes', date_trunc('day', now())));
insert into public.session_exercises (id, session_id, user_id, exercise_id, position)
  values ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000a6', :'ua', :'ex1', 1);
insert into public.session_sets (session_exercise_id, session_id, user_id, set_no, weight_kg, reps)
  values ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000a6', :'ua', 1, 50, 5),
         ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000a6', :'ua', 2, 50, 5),
         ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000a6', :'ua', 3, 50, 5);
select public.finish_workout_session('00000000-0000-0000-0000-0000000000a6');
select is((select current_streak from public.profiles where user_id = :'ua'), 1, 'a workout starts a 1-day streak');
delete from public.workout_sessions where id = '00000000-0000-0000-0000-0000000000a6';
select is((select current_streak from public.profiles where user_id = :'ua'), 0, 'deleting it resets the streak');
select ok((select last_active_on is null and total_points = 0 from public.profiles where user_id = :'ua'), 'and clears last_active_on and points');
-- short cardio earns nothing
insert into public.workout_sessions (id, user_id, kind, started_at) values ('00000000-0000-0000-0000-0000000000a7', :'ua', 'cardio', greatest(now() - interval '5 minutes', date_trunc('day', now())));
insert into public.cardio_entries (session_id, user_id, activity, duration_sec) values ('00000000-0000-0000-0000-0000000000a7', :'ua', 'run', 300);
select is((public.finish_workout_session('00000000-0000-0000-0000-0000000000a7')->>'points_awarded')::int, 0, 'cardio under 10 minutes earns no points');

-- energy helpers (run as the test owner) -------------------------------------------------
reset role;
select is(public.strength_met(9), 6.0, 'strength MET: vigorous when average RPE >= 8.5');
select is(public.cardio_met('walk', null), 3.5, 'cardio MET: walking default without distance');
insert into public.profile_private (user_id, start_weight_kg, sex, birth_year)
values (:'ua', 80, 'male', extract(year from current_date)::int - 30)
on conflict (user_id) do update set start_weight_kg = 80, sex = 'male', birth_year = extract(year from current_date)::int - 30;
insert into public.workout_sessions (id, user_id, kind, started_at) values ('00000000-0000-0000-0000-0000000000a8', :'ua', 'cardio', greatest(now() - interval '40 minutes', date_trunc('day', now())));
insert into public.cardio_entries (session_id, user_id, activity, duration_sec, avg_hr) values ('00000000-0000-0000-0000-0000000000a8', :'ua', 'run', 1800, 150);
-- Keytel (male, 150 bpm, 80 kg, 30 y): (-55.0969 + 94.635 + 15.904 + 6.051) / 4.184 = 14.70 kcal/min x 30 = 441
select is((select kcal from public.estimate_session_kcal('00000000-0000-0000-0000-0000000000a8', :'ua', 'cardio', 1800)), 441, 'kcal: heart-rate equation when weight, sex, age and HR are known');
select is((select weight_kg from public.estimate_session_kcal('00000000-0000-0000-0000-0000000000a8', :'ua', 'cardio', 1800)), 80::numeric, 'kcal: known weight is reported');
select ok(not has_function_privilege('authenticated', 'public.estimate_session_kcal(uuid, uuid, text, integer)', 'execute'), 'clients cannot call the estimator directly');

-- body metrics (Faz 2) ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
-- KVKK: health tables need explicit consent first
select throws_ok(
  $$ insert into public.body_metrics (user_id, measured_on, weight_kg) values ('00000000-0000-0000-0000-00000000000b', current_date, 80) $$,
  '42501', null, 'consent: health data cannot be written without explicit consent'
);
select public.record_consent('health_data', 'test');
select ok(public.has_health_consent(), 'consent: granting health consent is recorded');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select public.record_consent('health_data', 'test');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
insert into public.body_metrics (user_id, measured_on, weight_kg) values (:'ub', ((now() at time zone 'Europe/Istanbul')::date - 1), 82.4);
select is((select points from public.point_events where user_id = :'ub' and kind = 'weight_log' and ref_id like '%:w'), 10, 'body: a weight row awards 10 by trigger');
update public.body_metrics set weight_kg = 82.0 where user_id = :'ub';
select is((select count(*)::int from public.point_events where user_id = :'ub' and kind = 'weight_log' and ref_id like '%:w'), 1, 'body: correcting the weight does not award twice');
update public.body_metrics set waist_cm = 84 where user_id = :'ub';
select is((select points from public.point_events where user_id = :'ub' and kind = 'measurement_log'), 15, 'body: measurements award 15');
-- the client saves with an upsert that sends only the edited columns: other columns are kept
insert into public.body_metrics (user_id, measured_on, weight_kg) values (:'ub', ((now() at time zone 'Europe/Istanbul')::date - 1), 81.8)
  on conflict (user_id, measured_on) do update set weight_kg = excluded.weight_kg;
select ok((select weight_kg = 81.8 and waist_cm = 84 from public.body_metrics where user_id = :'ub'), 'body: upsert merges into the day''s row');
update public.body_metrics set weight_kg = 82.0 where user_id = :'ub';
update public.body_metrics set measured_on = current_date - 30, user_id = :'ua' where user_id = :'ub';
select ok((select measured_on = ((now() at time zone 'Europe/Istanbul')::date - 1) from public.body_metrics where user_id = :'ub'), 'body: day and owner of a row are frozen');
select throws_like(
  $$ insert into public.body_metrics (user_id, measured_on, weight_kg) values ('00000000-0000-0000-0000-00000000000b', current_date + 5, 80) $$,
  '%FUTURE_DATE%', 'body: future days are rejected'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select is((select count(*)::int from public.body_metrics), 0, 'body IDOR: alice sees none of bob''s rows');
select throws_ok(
  $$ insert into public.body_metrics (user_id, measured_on, weight_kg) values ('00000000-0000-0000-0000-00000000000b', current_date - 1, 50) $$,
  '42501', null, 'body IDOR: alice cannot write a row for bob'
);
update public.body_metrics set weight_kg = 40;
delete from public.body_metrics;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
select is((select weight_kg from public.body_metrics where user_id = :'ub'), 82.0::numeric, 'body IDOR: bob''s row is untouched by alice''s update/delete');
reset role;
select is(public.body_weight_for(:'ub', (now() at time zone 'Europe/Istanbul')::date), 82.0::numeric, 'energy weight: latest logged weight wins');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
delete from public.body_metrics where user_id = :'ub';
select is((select count(*)::int from public.point_events where user_id = :'ub' and kind in ('weight_log', 'measurement_log') and ref_id like '%:%'), 0, 'body: deleting the row revokes its points');
reset role;

-- nutrition (Faz 2) ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
insert into public.meal_entries (user_id, eaten_on, meal_slot, name, kcal, protein_g) values (:'ub', (now() at time zone 'Europe/Istanbul')::date, 'breakfast', 'Yumurta', 150, 12);
select is((select sum(points)::int from public.point_events where user_id = :'ub' and kind = 'meal_log'), 5, 'meals: an entry awards 5 by trigger');
insert into public.meal_entries (user_id, eaten_on, meal_slot, name, kcal) values
  (:'ub', (now() at time zone 'Europe/Istanbul')::date, 'lunch', 'a', 100), (:'ub', (now() at time zone 'Europe/Istanbul')::date, 'dinner', 'b', 100), (:'ub', (now() at time zone 'Europe/Istanbul')::date, 'snack', 'c', 100), (:'ub', (now() at time zone 'Europe/Istanbul')::date, 'snack', 'd', 100);
select is((select sum(points)::int from public.point_events where user_id = :'ub' and kind = 'meal_log'), 20, 'meals: capped at 20 a day');
update public.user_settings set daily_protein_g = 50 where user_id = :'ub';
insert into public.meal_entries (id, user_id, eaten_on, meal_slot, name, kcal, protein_g)
  values ('00000000-0000-0000-0000-0000000000c1', :'ub', (now() at time zone 'Europe/Istanbul')::date, 'dinner', 'Tavuk', 400, 45);
select is((select points from public.point_events where user_id = :'ub' and kind = 'protein_goal'), 15, 'meals: reaching the protein goal awards 15');
delete from public.meal_entries where id = '00000000-0000-0000-0000-0000000000c1';
select is((select count(*)::int from public.point_events where user_id = :'ub' and kind = 'protein_goal'), 0, 'meals: dropping below the protein goal revokes it');
update public.user_settings set daily_protein_g = 5 where user_id = :'ub';
insert into public.meal_entries (id, user_id, eaten_on, meal_slot, name, kcal, protein_g)
  values ('00000000-0000-0000-0000-0000000000c3', :'ub', (now() at time zone 'Europe/Istanbul')::date, 'dinner', 'Yumurta', 80, 6);
select is((select count(*)::int from public.point_events where user_id = :'ub' and kind = 'protein_goal'), 0, 'meals: a token protein goal (< 40 g) earns nothing');
delete from public.meal_entries where id = '00000000-0000-0000-0000-0000000000c3';
select throws_like(
  $$ insert into public.meal_entries (user_id, eaten_on, meal_slot, name, kcal) values ('00000000-0000-0000-0000-00000000000b', current_date + 5, 'lunch', 'x', 1) $$,
  '%FUTURE_DATE%', 'meals: future days are rejected'
);
select throws_like($$ select public.ai_reserve() $$, '%AI_CONSENT_REQUIRED%', 'ai: no AI request before explicit consent (18+, free-tier terms)');
select public.record_consent('ai_processing', 'test');
select is((public.ai_reserve() ->> 'user_left')::int, 9, 'ai: a request is counted against the daily limit');
select throws_ok(
  $$ insert into public.ai_usage (user_id, day, request_count) values ('00000000-0000-0000-0000-00000000000b', current_date, 0) $$,
  '42501', null, 'ai: clients cannot write the usage counter'
);
update public.user_settings set ai_daily_limit = 1000 where user_id = :'ub';
select is((select ai_daily_limit from public.user_settings where user_id = :'ub'), 10, 'ai: users cannot raise their own AI limit');
update public.user_settings set tour_completed_at = null where user_id = :'ub';
update public.user_settings set tour_completed_at = now() where user_id = :'ub';
update public.user_settings set tour_completed_at = now() where user_id = :'ua';
select isnt((select tour_completed_at from public.user_settings where user_id = :'ub'), null::timestamptz, 'tour: the owner can mark the tour as seen');
reset role;
select is((select tour_completed_at from public.user_settings where user_id = :'ua'), null::timestamptz, 'tour: nobody can write another user''s tour state');
set local role authenticated;
reset role;
update public.user_settings set ai_daily_limit = 1 where user_id = :'ub';
set local role authenticated;
select throws_like($$ select public.ai_reserve() $$, '%AI_QUOTA%', 'ai: the daily limit is enforced');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
insert into public.foods (id, user_id, name, kcal) values ('00000000-0000-0000-0000-0000000000d1', :'ua', 'Alice yulaf', 300);
select is((select count(*)::int from public.meal_entries), 0, 'meals IDOR: alice sees none of bob''s meals');
select throws_ok(
  $$ insert into public.meal_entries (user_id, eaten_on, meal_slot, name, kcal) values ('00000000-0000-0000-0000-00000000000b', current_date - 1, 'lunch', 'x', 1) $$,
  '42501', null, 'meals IDOR: alice cannot write a meal for bob'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
select is((select count(*)::int from public.foods), 0, 'foods IDOR: bob sees none of alice''s foods');
insert into public.meal_entries (id, user_id, eaten_on, meal_slot, food_id, name, kcal)
  values ('00000000-0000-0000-0000-0000000000c2', :'ub', (now() at time zone 'Europe/Istanbul')::date, 'snack', '00000000-0000-0000-0000-0000000000d1', 'x', 1);
select is((select food_id from public.meal_entries where id = '00000000-0000-0000-0000-0000000000c2'), null::uuid, 'meals: another user''s food id is dropped');
reset role;

-- AI usage log + admin dashboard ----------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
select lives_ok($$ select public.ai_log_usage('food_estimate_text', 'gemini', 'gemini-3.8-flash', 120, 80, 200, true) $$, 'ai log: a user can log their own request');
select throws_like($$ select public.ai_log_usage('catalog_translate', 'gemini', 'x', 1, 1, 2, true) $$, '%BAD_ACTION%', 'ai log: users cannot log system actions');
select lives_ok($$ select public.ai_log_usage('food_estimate_text', 'gemini', 'gemini-3.5-flash-lite', 1, 1, 2, true) $$, 'ai log: fallback attempts of one request are logged');
select lives_ok($$ select public.ai_log_usage('food_estimate_text', 'openrouter', 'x', 1, 1, 2, true) $$, 'ai log: up to three attempts per request');
select throws_like($$ select public.ai_log_usage('food_estimate_text', 'gemini', 'gemini-3.8-flash', 1, 1, 2, true) $$, '%NO_RESERVATION%', 'ai log: rows beyond the reserved requests are refused (no quota flooding)');
select is((select count(*)::int from public.ai_usage_log), 0, 'ai log: users cannot read the log directly');
select throws_ok($$ insert into public.ai_usage_log (action, provider, model) values ('coach_chat', 'gemini', 'x') $$, '42501', null, 'ai log: users cannot insert directly');
select throws_like($$ select * from public.admin_ai_usage(30) $$, '%FORBIDDEN%', 'ai log: non-admins cannot read the dashboard');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select is((select sum(total_tokens)::int from public.admin_ai_usage(30) where username = 'bob'), 204, 'ai log: the admin sees who used how many tokens');
select is((select requests_today from public.admin_ai_live() where model = 'gemini-3.8-flash'), 1, 'ai log: the admin sees today''s requests per model');
select ok((select global_limit > 0 from public.admin_ai_app_today()), 'ai log: the admin sees the app''s daily budget');
reset role;

-- error reports -------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
select lives_ok($$ insert into public.error_reports (route, message_key, error_code, request, response) values ('/track', 'errors.unknown', 'XX000', '{"method":"GET"}', '{"status":500}') $$, 'reports: a user can report an error');
select throws_ok($$ insert into public.error_reports (user_id, route) values ('00000000-0000-0000-0000-00000000000a', '/x') $$, '42501', null, 'reports: nobody can report in someone else''s name');
select is((select count(*)::int from public.error_reports), 0, 'reports: users cannot read reports');
select throws_like($$ select * from public.admin_error_reports('open', 10) $$, '%FORBIDDEN%', 'reports: non-admins cannot list reports');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select is((select username from public.admin_error_reports('open', 10) limit 1), 'bob', 'reports: the admin sees who reported');
update public.error_reports set status = 'resolved';
select ok((select resolved_at is not null from public.error_reports limit 1), 'reports: resolving stamps the time');
select is((select count(*)::int from public.admin_error_reports('open', 10)), 0, 'reports: resolved reports leave the open list');
reset role;

-- AI gate: Google free-tier quota is shared by all users ------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select public.record_consent('ai_processing', 'test');
select is((public.ai_availability() ->> 'available')::boolean, true, 'gate: AI available with quota left');
reset role;
insert into public.ai_usage_log (user_id, action, provider, model, total_tokens)
  select null, 'catalog_translate', 'gemini', 'gemini-3.8-flash', 10 from generate_series(1, 19);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select is(public.ai_reserve() -> 'models', '["gemini-3.5-flash-lite"]'::jsonb, 'gate: Flash daily quota used up -> only Lite is offered');
reset role;
insert into public.ai_usage_log (user_id, action, provider, model, total_tokens)
  select null, 'catalog_translate', 'gemini', 'gemini-3.5-flash-lite', 10 from generate_series(1, 15);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select is(public.ai_availability() ->> 'reason', 'google_minute', 'gate: per-minute limit reached -> wait a minute');
select throws_like($$ select public.ai_reserve() $$, '%AI_GOOGLE_MINUTE%', 'gate: reserve refuses during the minute limit');
reset role;
insert into public.ai_usage_log (user_id, action, provider, model, total_tokens, created_at)
  select null, 'catalog_translate', 'gemini', 'gemini-3.5-flash-lite', 10, now() - interval '5 minutes' from generate_series(1, 485);
update public.ai_usage_log set created_at = now() - interval '5 minutes';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select is(public.ai_availability() ->> 'reason', 'google_daily', 'gate: every model''s daily quota used up');
select throws_like($$ select public.ai_reserve() $$, '%AI_GOOGLE_DAILY%', 'gate: reserve refuses until the Pacific reset');
reset role;

-- sleep and water (Faz 2) ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
insert into public.sleep_entries (id, user_id, sleep_on, bed_at, wake_at, quality)
  values ('00000000-0000-0000-0000-0000000000f1', :'ub', current_date, now() - interval '9 hours', now() - interval '1 hour', 4);
select is((select duration_min from public.sleep_entries where id = '00000000-0000-0000-0000-0000000000f1'), 480, 'sleep: duration derived from bed and wake times');
select is((select points from public.point_events where user_id = :'ub' and kind = 'sleep_log'), 10, 'sleep: a 7 h+ night earns 10');
update public.sleep_entries set bed_at = now() - interval '7 hours' where id = '00000000-0000-0000-0000-0000000000f1';
select is((select points from public.point_events where user_id = :'ub' and kind = 'sleep_log'), 5, 'sleep: a shorter night re-scores to 5');
select throws_like(
  $$ insert into public.sleep_entries (user_id, sleep_on, bed_at, wake_at) values ('00000000-0000-0000-0000-00000000000b', current_date - 3, now() - interval '3 days', now() - interval '4 days') $$,
  '%SLEEP_ORDER%', 'sleep: waking before going to bed is rejected'
);
update public.user_settings set daily_water_ml = 1000 where user_id = :'ub';
insert into public.water_entries (user_id, drunk_on, amount_ml) values (:'ub', current_date, 600);
select is((select count(*)::int from public.point_events where user_id = :'ub' and kind = 'water_goal'), 0, 'water: below the goal earns nothing yet');
insert into public.water_entries (id, user_id, drunk_on, amount_ml) values ('00000000-0000-0000-0000-0000000000f2', :'ub', current_date, 500);
select is((select points from public.point_events where user_id = :'ub' and kind = 'water_goal'), 10, 'water: reaching the goal earns 10');
delete from public.water_entries where id = '00000000-0000-0000-0000-0000000000f2';
select is((select count(*)::int from public.point_events where user_id = :'ub' and kind = 'water_goal'), 0, 'water: dropping below the goal revokes it');
select throws_like(
  $$ insert into public.water_entries (user_id, drunk_on, amount_ml) values ('00000000-0000-0000-0000-00000000000b', current_date + 3, 250) $$,
  '%FUTURE_DATE%', 'water: future days are rejected'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select is((select count(*)::int from public.sleep_entries) + (select count(*)::int from public.water_entries), 0, 'sleep/water IDOR: alice sees none of bob''s rows');
select throws_ok(
  $$ insert into public.water_entries (user_id, drunk_on, amount_ml) values ('00000000-0000-0000-0000-00000000000b', current_date, 250) $$,
  '42501', null, 'sleep/water IDOR: alice cannot log water for bob'
);
reset role;

-- encrypted progress photos (Faz 2) -----------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
insert into public.photo_vault (user_id, kdf, wrapped_key, wrap_iv, recovery_kdf, recovery_wrapped_key, recovery_iv)
  values (:'ub', '{"alg":"argon2id"}', repeat('A', 64), repeat('B', 16), '{"alg":"argon2id"}', repeat('C', 64), repeat('D', 16));
update public.photo_vault set wrapped_key = repeat('E', 64), recovery_wrapped_key = repeat('F', 64) where user_id = :'ub';
select is((select wrapped_key || '/' || recovery_wrapped_key from public.photo_vault), repeat('E', 64) || '/' || repeat('C', 64), 'photos: a password change rewraps, the recovery wrap is immutable');
delete from public.photo_vault where user_id = :'ub';
select is((select count(*)::int from public.photo_vault), 1, 'photos: a vault cannot be deleted (photos would be lost)');
select throws_ok(
  $$ insert into public.photo_vault (user_id, kdf, wrapped_key, wrap_iv, recovery_kdf, recovery_wrapped_key, recovery_iv)
     values ('00000000-0000-0000-0000-00000000000b', '{}', repeat('A', 64), repeat('B', 16), '{}', repeat('C', 64), repeat('D', 16)) $$,
  '23505', null, 'photos: an existing vault cannot be overwritten'
);
select throws_like(
  $$ insert into public.progress_photos (id, user_id, taken_on, pose, image_path, thumb_path, image_iv, thumb_iv)
     values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000b', current_date, 'front',
             '00000000-0000-0000-0000-00000000000b/00000000-0000-0000-0000-0000000000e1.img.bin',
             '00000000-0000-0000-0000-00000000000b/00000000-0000-0000-0000-0000000000e1.thumb.bin', repeat('i', 16), repeat('t', 16)) $$,
  '%MISSING_UPLOAD%', 'photos: a row needs its encrypted objects uploaded first'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('progress-photos', '00000000-0000-0000-0000-00000000000b/photo.jpg') $$,
  '42501', null, 'photos: object names must be <uid>/<uuid>.img|thumb.bin'
);
insert into storage.objects (bucket_id, name) values
  ('progress-photos', '00000000-0000-0000-0000-00000000000b/00000000-0000-0000-0000-0000000000e1.img.bin'),
  ('progress-photos', '00000000-0000-0000-0000-00000000000b/00000000-0000-0000-0000-0000000000e1.thumb.bin'),
  ('progress-photos', '00000000-0000-0000-0000-00000000000b/00000000-0000-0000-0000-0000000000e2.img.bin'),
  ('progress-photos', '00000000-0000-0000-0000-00000000000b/00000000-0000-0000-0000-0000000000e2.thumb.bin');
select is(public.progress_photo_object_count(), 4, 'photos: the owner''s object count feeds the per-user cap');
insert into public.progress_photos (id, user_id, taken_on, pose, image_path, thumb_path, image_iv, thumb_iv)
  values ('00000000-0000-0000-0000-0000000000e1', :'ub', current_date, 'front',
          '00000000-0000-0000-0000-00000000000b/00000000-0000-0000-0000-0000000000e1.img.bin',
          '00000000-0000-0000-0000-00000000000b/00000000-0000-0000-0000-0000000000e1.thumb.bin', repeat('i', 16), repeat('t', 16));
select is((select points from public.point_events where user_id = :'ub' and kind = 'progress_photo'), 25, 'photos: a progress photo earns 25');
insert into public.progress_photos (id, user_id, taken_on, pose, image_path, thumb_path, image_iv, thumb_iv)
  values ('00000000-0000-0000-0000-0000000000e2', :'ub', current_date, 'side',
          '00000000-0000-0000-0000-00000000000b/00000000-0000-0000-0000-0000000000e2.img.bin',
          '00000000-0000-0000-0000-00000000000b/00000000-0000-0000-0000-0000000000e2.thumb.bin', repeat('i', 16), repeat('t', 16));
select is((select sum(points)::int from public.point_events where user_id = :'ub' and kind = 'progress_photo'), 25, 'photos: once a week');
select throws_like(
  $$ insert into public.progress_photos (id, user_id, taken_on, pose, image_path, thumb_path, image_iv, thumb_iv)
     values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000000b', current_date, 'front',
             '00000000-0000-0000-0000-00000000000a/x.img.bin', '00000000-0000-0000-0000-00000000000a/x.thumb.bin', repeat('i', 16), repeat('t', 16)) $$,
  '%BAD_PATH%', 'photos: storage paths must be in the owner''s folder'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select is((select count(*)::int from public.photo_vault), 0, 'photos IDOR: alice cannot read bob''s wrapped key');
select is((select count(*)::int from public.progress_photos), 0, 'photos IDOR: alice sees none of bob''s photos');
select is(public.progress_photo_object_count(), 0, 'photos IDOR: the object count covers only the caller''s folder');
select throws_ok(
  $$ insert into public.photo_vault (user_id, kdf, wrapped_key, wrap_iv, recovery_kdf, recovery_wrapped_key, recovery_iv)
     values ('00000000-0000-0000-0000-00000000000b', '{}', repeat('A', 64), repeat('B', 16), '{}', repeat('C', 64), repeat('D', 16)) $$,
  '42501', null, 'photos IDOR: alice cannot replace bob''s vault'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
delete from public.progress_photos where id = '00000000-0000-0000-0000-0000000000e1';
select is((select coalesce(sum(points), 0)::int from public.point_events where user_id = :'ub' and kind = 'progress_photo'), 0, 'photos: deleting the photo revokes its points');
reset role;
select is((select public from storage.buckets where id = 'progress-photos'), false, 'photos: the bucket is private');
select is((select allowed_mime_types from storage.buckets where id = 'progress-photos'), array['application/octet-stream'], 'photos: the bucket only accepts ciphertext');

-- habits + to-dos (Faz 3) ---------------------------------------------------------------------
\set h1 '00000000-0000-0000-0000-000000000301'
\set h2 '00000000-0000-0000-0000-000000000302'
\set hb '00000000-0000-0000-0000-0000000003b1'
\set t1 '00000000-0000-0000-0000-000000000311'
\set t2 '00000000-0000-0000-0000-000000000312'
\set t3 '00000000-0000-0000-0000-000000000313'
\set tb '00000000-0000-0000-0000-0000000003b2'
reset role;
-- The SQL rule matcher and src/lib/recurrence.ts agree on the shared vectors (generated from
-- src/lib/recurrence.vectors.json; regenerate this list when the file changes).
select is(
  (select coalesce(array_agg('#' || v.n || ' ' || v.rule || ' ' || v.starts_on || ' ' || v.day order by v.n), '{}')
     from (values
     (1, '{"type":"daily"}', '2026-11-02', '2026-11-01', false),
     (2, '{"type":"daily"}', '2026-11-02', '2026-11-02', true),
     (3, '{"type":"daily"}', '2026-11-02', '2027-03-28', true),
     (4, '{"type":"weekly","days":[1,3,5]}', '2026-11-01', '2026-11-02', true),
     (5, '{"type":"weekly","days":[1,3,5]}', '2026-11-01', '2026-11-03', false),
     (6, '{"type":"weekly","days":[1,3,5]}', '2026-11-01', '2026-11-06', true),
     (7, '{"type":"weekly","days":[7]}', '2026-11-01', '2026-11-08', true),
     (8, '{"type":"weekly","days":[7]}', '2026-11-01', '2026-11-07', false),
     (9, '{"type":"weekly_count","n":3}', '2026-11-01', '2026-11-04', true),
     (10, '{"type":"monthly","day":15}', '2026-01-01', '2026-11-15', true),
     (11, '{"type":"monthly","day":15}', '2026-01-01', '2026-11-16', false),
     (12, '{"type":"monthly","day":31}', '2026-01-01', '2026-02-28', true),
     (13, '{"type":"monthly","day":31}', '2026-01-01', '2028-02-29', true),
     (14, '{"type":"monthly","day":31}', '2026-01-01', '2028-02-28', false),
     (15, '{"type":"monthly","day":31}', '2026-01-01', '2026-04-30', true),
     (16, '{"type":"monthly","day":30}', '2026-01-01', '2026-05-30', true),
     (17, '{"type":"every","n":2}', '2026-10-30', '2026-10-30', true),
     (18, '{"type":"every","n":2}', '2026-10-30', '2026-10-31', false),
     (19, '{"type":"every","n":2}', '2026-10-30', '2026-11-01', true),
     (20, '{"type":"every","n":3}', '2026-03-27', '2026-04-02', true),
     (21, '{"type":"every","n":3}', '2026-03-27', '2026-03-24', false)
     ) as v(n, rule, starts_on, day, expect)
    where public.recurrence_matches(v.rule::jsonb, v.starts_on::date, v.day::date) is distinct from v.expect),
  '{}'::text[], 'recurrence_matches agrees with every vector in recurrence.vectors.json (21)'
);
select ok(
  public.recurrence_valid('{"type":"daily"}', false) and public.recurrence_valid('{"type":"weekly","days":[1,3,5]}', false)
  and public.recurrence_valid('{"type":"weekly_count","n":7}', true) and public.recurrence_valid('{"type":"monthly","day":31}', false)
  and public.recurrence_valid('{"type":"every","n":365}', false),
  'recurrence_valid accepts every rule type'
);
select is(
  (select array_agg(v.r || ' allow=' || v.a order by v.r)
     from (values
       ('{"type":"weekly","days":[0]}', true), ('{"type":"weekly","days":[8]}', true), ('{"type":"weekly","days":[]}', true),
       ('{"type":"weekly","days":[1,1]}', true), ('{"type":"weekly","days":["1"]}', true), ('{"type":"weekly"}', true),
       ('{"type":"weekly_count","n":3}', false), ('{"type":"weekly_count","n":8}', true), ('{"type":"monthly","day":0}', true),
       ('{"type":"monthly","day":32}', true), ('{"type":"monthly","day":1.5}', true), ('{"type":"every","n":1}', true),
       ('{"type":"every","n":366}', true), ('{"type":"yearly"}', true), ('{}', true), ('[]', true), ('"daily"', true)
     ) as v(r, a)
    where public.recurrence_valid(v.r::jsonb, v.a)),
  null, 'recurrence_valid rejects malformed rules (and weekly_count where not allowed)'
);
select ok(
  (select bool_and(not p.prosecdef and p.provolatile = 'i') from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('recurrence_valid', 'recurrence_matches')),
  'recurrence helpers are immutable and not security definer'
);
select ok(
  not has_function_privilege('anon', 'public.recurrence_valid(jsonb, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.recurrence_matches(jsonb, date, date)', 'execute'),
  'recurrence helpers: anon cannot execute them'
);
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('habits_guard', 'todos_guard', 'habit_logs_guard', 'todo_completions_guard', 'habit_logs_points', 'todo_completions_points')
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
  0, 'habits/todos: guard and points trigger functions are not executable by clients'
);

-- Bob's rows (the IDOR targets)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
insert into public.habits (id, user_id, name) values (:'hb', :'ub', 'Bob kitap');
insert into public.habit_logs (user_id, habit_id, day) values (:'ub', :'hb', current_date);
insert into public.todos (id, user_id, title) values (:'tb', :'ub', 'Bob gorev');
insert into public.todo_completions (user_id, todo_id, day) values (:'ub', :'tb', current_date);
select is(
  (select count(*)::int from public.habits) + (select count(*)::int from public.habit_logs)
  + (select count(*)::int from public.todos) + (select count(*)::int from public.todo_completions),
  4, 'habits/todos: the owner writes and reads his habit, log, to-do and completion'
);

-- Alice: a yes/no habit and a counter habit (3 pages a day)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
insert into public.habits (id, user_id, name) values (:'h1', :'ua', 'Su ic');
insert into public.habits (id, user_id, name, target_count, unit) values (:'h2', :'ua', 'Kitap oku', 3, 'sayfa');
select is((select starts_on from public.habits where id = :'h1'), (now() at time zone 'Europe/Istanbul')::date, 'habits: starts_on defaults to the Istanbul day');
select is(
  (select count(*)::int from public.habits where user_id = :'ub') + (select count(*)::int from public.habit_logs where user_id = :'ub')
  + (select count(*)::int from public.todos where user_id = :'ub') + (select count(*)::int from public.todo_completions where user_id = :'ub'),
  0, 'habits/todos IDOR: alice reads none of bob''s habits, logs, to-dos or completions'
);
select throws_ok(
  $$ insert into public.habit_logs (user_id, habit_id, day) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000003b1', current_date - 1) $$,
  '42501', 'FORBIDDEN', 'habits IDOR: alice cannot log against bob''s habit id, even with her own user_id'
);
select throws_ok(
  $$ insert into public.todo_completions (user_id, todo_id, day) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000003b2', current_date) $$,
  '42501', 'FORBIDDEN', 'todos IDOR: alice cannot complete bob''s to-do, even with her own user_id'
);
select throws_ok(
  $$ insert into public.habits (user_id, name) values ('00000000-0000-0000-0000-00000000000b', 'x') $$,
  '42501', null, 'habits IDOR: alice cannot create a habit owned by bob'
);
update public.habits set name = 'HACKED' where id = :'hb';
update public.todos set title = 'HACKED' where id = :'tb';
delete from public.habit_logs where habit_id = :'hb';
delete from public.todo_completions where todo_id = :'tb';

-- habit_done
insert into public.habit_logs (user_id, habit_id, day) values (:'ua', :'h1', current_date);
select is(
  (select points from public.point_events where user_id = :'ua' and kind = 'habit_done' and ref_table = 'habit_logs' and ref_id = :'h1' || ':' || current_date::text),
  10, 'habits: a yes/no habit done today earns 10'
);
select throws_like(
  $$ insert into public.habit_logs (user_id, habit_id, day) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000301', current_date + 1) $$,
  '%FUTURE_DATE%', 'habits: a future day cannot be logged'
);
update public.habit_logs set day = current_date - 3, habit_id = :'h2', user_id = :'ub' where habit_id = :'h1';
select ok(
  (select day = current_date and user_id = :'ua'::uuid from public.habit_logs where habit_id = :'h1'),
  'habits: owner, habit and day of a log are frozen'
);
insert into public.habit_logs (user_id, habit_id, day, count) values (:'ua', :'h2', current_date, 2);
select is(
  (select count(*)::int from public.point_events where user_id = :'ua' and ref_table = 'habit_logs' and ref_id = :'h2' || ':' || current_date::text),
  0, 'habits: a counter habit below its target (2 of 3) earns nothing'
);
update public.habit_logs set count = 3 where habit_id = :'h2';
select is(
  (select points from public.point_events where user_id = :'ua' and ref_table = 'habit_logs' and ref_id = :'h2' || ':' || current_date::text),
  10, 'habits: reaching the target (3 of 3) earns 10'
);
update public.habit_logs set count = 5 where habit_id = :'h2';
select is(
  (select count(*)::int from public.point_events where user_id = :'ua' and ref_table = 'habit_logs' and ref_id = :'h2' || ':' || current_date::text),
  1, 'habits: going past the target does not award twice'
);
update public.habit_logs set count = 1 where habit_id = :'h2';
select is(
  (select count(*)::int from public.point_events where user_id = :'ua' and ref_table = 'habit_logs' and ref_id = :'h2' || ':' || current_date::text),
  0, 'habits: dropping below the target revokes the points'
);
update public.habit_logs set count = 3 where habit_id = :'h2';
delete from public.habit_logs where habit_id = :'h2';
select is(
  (select count(*)::int from public.point_events where user_id = :'ua' and ref_table = 'habit_logs' and ref_id = :'h2' || ':' || current_date::text),
  0, 'habits: deleting a completed log revokes the points'
);
select throws_ok(
  $$ insert into public.habits (user_id, name, rule) values ('00000000-0000-0000-0000-00000000000a', 'x', '{"type":"weekly","days":[0]}') $$,
  '23514', null, 'habits: an invalid rule (weekday 0) is rejected'
);
select lives_ok(
  $$ insert into public.habits (user_id, name, rule) values ('00000000-0000-0000-0000-00000000000a', 'Spor', '{"type":"weekly_count","n":3}') $$,
  'habits: weekly_count is allowed for habits'
);
insert into public.habits (user_id, name) select :'ua', 'cap ' || g from generate_series(1, 5) g;
insert into public.habit_logs (user_id, habit_id, day) select :'ua', id, current_date from public.habits where name like 'cap %';
select is(
  (select sum(points)::int from public.point_events where user_id = :'ua' and kind = 'habit_done' and occurred_on = current_date),
  50, 'habits: habit_done is capped at 50 a day (6 habits done)'
);
insert into public.habits (user_id, name) select :'ua', 'fill ' || g from generate_series(1, 42) g;
select is((select count(*)::int from public.habits where archived_at is null), 50, 'habits: 50 active habits are allowed');
select throws_like(
  $$ insert into public.habits (user_id, name) values ('00000000-0000-0000-0000-00000000000a', 'one too many') $$,
  '%LIMIT_REACHED%', 'habits: the 51st active habit is rejected'
);
update public.habits set archived_at = now() where name = 'fill 1';
select lives_ok(
  $$ insert into public.habits (user_id, name) values ('00000000-0000-0000-0000-00000000000a', 'after archive') $$,
  'habits: archiving a habit frees a slot'
);
select throws_like(
  $$ update public.habits set archived_at = null where name = 'fill 1' $$,
  '%LIMIT_REACHED%', 'habits: un-archiving past the limit is rejected'
);

-- todo_done: one-off t1 (someday), one-off t2 (due tomorrow, reminder), recurring t3 (today's weekday)
insert into public.todos (id, user_id, title) values (:'t1', :'ua', 'Fatura ode');
insert into public.todos (id, user_id, title, due_on, remind_at) values (:'t2', :'ua', 'Randevu', current_date + 1, '09:00');
insert into public.todos (id, user_id, title, rule, starts_on)
  values (:'t3', :'ua', 'Haftalik rapor', jsonb_build_object('type', 'weekly', 'days', jsonb_build_array(extract(isodow from current_date)::int)), current_date - 14);
insert into public.todo_completions (user_id, todo_id, day) values (:'ua', :'t1', current_date);
select is(
  (select points from public.point_events where user_id = :'ua' and kind = 'todo_done' and ref_table = 'todo_completions' and ref_id = :'t1' || ':' || current_date::text),
  5, 'todos: ticking a to-do earns 5'
);
select throws_like(
  $$ insert into public.todo_completions (user_id, todo_id, day, completed_on) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000311', current_date - 1, current_date - 1) $$,
  '%ALREADY_DONE%', 'todos: a one-off to-do is completed at most once'
);
delete from public.todo_completions where todo_id = :'t1';
select is(
  (select count(*)::int from public.point_events where user_id = :'ua' and ref_table = 'todo_completions' and ref_id like :'t1' || ':%'),
  0, 'todos: un-ticking revokes the points'
);
insert into public.todo_completions (user_id, todo_id, day) values (:'ua', :'t2', current_date);
select ok(
  (select day = current_date + 1 and completed_on = current_date from public.todo_completions where todo_id = :'t2'),
  'todos: a one-off due later can be ticked early (day = due_on, points on the tick day)'
);
select throws_like(
  $$ insert into public.todo_completions (user_id, todo_id, day, completed_on) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000311', current_date + 1, current_date + 1) $$,
  '%FUTURE_DATE%', 'todos: a tick cannot be dated in the future'
);
insert into public.todo_completions (user_id, todo_id, day) values (:'ua', :'t3', current_date);
select is(
  (select points from public.point_events where user_id = :'ua' and ref_table = 'todo_completions' and ref_id = :'t3' || ':' || current_date::text),
  5, 'todos: a recurring occurrence earns 5'
);
select throws_like(
  $$ insert into public.todo_completions (user_id, todo_id, day) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000313', current_date - 1) $$,
  '%NOT_DUE%', 'todos: a recurring to-do cannot be ticked on a non-occurrence day'
);
select throws_like(
  $$ insert into public.todo_completions (user_id, todo_id, day) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000313', current_date + 7) $$,
  '%FUTURE_DATE%', 'todos: a future occurrence cannot be ticked'
);
select throws_ok(
  $$ insert into public.todos (user_id, title, rule) values ('00000000-0000-0000-0000-00000000000a', 'x', '{"type":"weekly_count","n":3}') $$,
  '23514', null, 'todos: weekly_count is for habits only'
);
select throws_ok(
  $$ insert into public.todos (user_id, title, remind_at) values ('00000000-0000-0000-0000-00000000000a', 'x', '08:00') $$,
  '23514', null, 'todos: a reminder needs a due day or a rule'
);
insert into public.todos (user_id, title) select :'ua', 'cap ' || g from generate_series(1, 5) g;
insert into public.todo_completions (user_id, todo_id, day) select :'ua', id, current_date from public.todos where title like 'cap %';
select is(
  (select sum(points)::int from public.point_events where user_id = :'ua' and kind = 'todo_done' and occurred_on = current_date),
  30, 'todos: todo_done is capped at 30 a day (7 ticks)'
);
delete from public.todos where id = :'t3';
select is(
  (select count(*)::int from public.point_events where user_id = :'ua' and ref_table = 'todo_completions' and ref_id like :'t3' || ':%'),
  0, 'todos: deleting a to-do cascades to its completions and revokes their points'
);
insert into public.todos (user_id, title) select :'ua', 'fill ' || g from generate_series(1, 500 - (select count(*)::int from public.todos)) g;
select throws_like(
  $$ insert into public.todos (user_id, title) values ('00000000-0000-0000-0000-00000000000a', 'one too many') $$,
  '%LIMIT_REACHED%', 'todos: the 501st to-do is rejected'
);
select throws_ok(
  $$ insert into public.point_events (user_id, kind, points, occurred_on, ref_table, ref_id)
     values ('00000000-0000-0000-0000-00000000000a', 'habit_done', 10, current_date, 'habit_logs', 'x') $$,
  '42501', null, 'habits/todos: clients cannot write habit or to-do points'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
select ok(
  (select name = 'Bob kitap' from public.habits where id = :'hb')
  and (select title = 'Bob gorev' from public.todos where id = :'tb')
  and (select count(*) = 1 from public.habit_logs where habit_id = :'hb')
  and (select count(*) = 1 from public.todo_completions where todo_id = :'tb'),
  'habits/todos IDOR: alice''s updates and deletes left bob''s rows untouched'
);
reset role;

-- push reminders (Faz 3 step 4) -----------------------------------------------------------------
\set pe1 'https://fcm.googleapis.com/fcm/send/device-one'
\set pk 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'
\set pa 'tBHItJI5svbpez7KI4CCXg'
\set psecret 'test-dispatch-secret-0123456789abcdef'
\set purl 'http://127.0.0.1:9/push'
reset role;
select ok(
  not has_function_privilege('authenticated', 'public.dispatch_reminders()', 'execute')
  and not has_function_privilege('anon', 'public.dispatch_reminders()', 'execute')
  and not has_function_privilege('authenticated', 'public.set_push_config(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.set_push_config(text, text)', 'execute')
  and has_function_privilege('service_role', 'public.set_push_config(text, text)', 'execute'),
  'push: dispatch_reminders and set_push_config are not executable by clients (set_push_config: service_role only)'
);
select ok(
  not has_schema_privilege('authenticated', 'private', 'usage') and not has_schema_privilege('anon', 'private', 'usage')
  and not has_table_privilege('authenticated', 'private.push_config', 'select')
  and not has_table_privilege('authenticated', 'private.reminder_log', 'select')
  and not has_table_privilege('anon', 'private.push_config', 'select')
  and not has_function_privilege('authenticated', 'private.reminders_due(date, time, time)', 'execute'),
  'push: the private schema (dispatch secret, reminder log, due query) is closed to clients'
);
select is(
  (select count(*)::int from cron.job where jobname = 'push-reminders' and schedule = '*/5 * * * *' and command = 'select public.dispatch_reminders()'),
  1, 'push: the dispatcher is scheduled every 5 minutes'
);
select ok(
  (select prosecdef and 'TimeZone=Europe/Istanbul' = any (proconfig) from pg_proc where oid = 'public.dispatch_reminders()'::regprocedure),
  'push: dispatch_reminders is security definer and runs on Istanbul time'
);
select is(public.dispatch_reminders(), 0, 'push: without push_config the dispatcher does nothing');

-- Subscriptions: register, validate, cap, move between accounts, unregister
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select public.register_push(:'pe1', :'pk', :'pa', 'Mozilla/5.0 (iPhone)');
select is(
  (select user_id from public.push_subscriptions where endpoint = :'pe1'), :'ua'::uuid,
  'push: register_push stores the device for the caller'
);
select throws_ok(
  $$ select public.register_push('http://push.example.com/x', 'abc', 'def', null) $$,
  '22023', 'BAD_ENDPOINT', 'push: endpoints must be https'
);
select throws_ok(
  format('select public.register_push(%L, %L, %L, null)', 'https://fcm.googleapis.com/fcm/send/' || repeat('x', 1000), 'abc', 'def'),
  '22023', 'BAD_ENDPOINT', 'push: endpoints over 1000 characters are rejected'
);
select throws_ok(
  $$ select public.register_push('https://fcm.googleapis.com/fcm/send/k', repeat('k', 201), 'def', null) $$,
  '22023', 'BAD_KEY', 'push: oversized keys are rejected'
);
select throws_ok(
  $$ insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('00000000-0000-0000-0000-00000000000a', 'https://fcm.googleapis.com/fcm/send/direct', 'k', 'a') $$,
  '42501', null, 'push: clients cannot insert subscriptions directly'
);
select throws_ok(
  $$ update public.push_subscriptions set p256dh = 'x' $$,
  '42501', null, 'push: clients cannot update subscriptions'
);
select lives_ok(
  $$ select public.register_push('https://fcm.googleapis.com/fcm/send/alice-' || lpad(g::text, 2, '0'), 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg', null)
       from generate_series(1, 11) g $$,
  'push: alice registers 11 more devices'
);
select ok(
  (select count(*) = 10 from public.push_subscriptions)
  and not exists (select 1 from public.push_subscriptions where endpoint in (:'pe1', 'https://fcm.googleapis.com/fcm/send/alice-01'))
  and exists (select 1 from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/alice-11'),
  'push: at most 10 devices per user, the oldest are dropped'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
select public.register_push('https://fcm.googleapis.com/fcm/send/alice-11', :'pk', :'pa', null);
select is(
  (select array_agg(endpoint) from public.push_subscriptions), array['https://fcm.googleapis.com/fcm/send/alice-11'],
  'push: re-registering an endpoint from another account moves it there (bob sees only his device)'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select ok(
  (select count(*) = 9 from public.push_subscriptions)
  and not exists (select 1 from public.push_subscriptions where user_id = :'ub' or endpoint = 'https://fcm.googleapis.com/fcm/send/alice-11'),
  'push IDOR: alice sees only her own devices, not the one that moved to bob'
);
select public.unregister_push('https://fcm.googleapis.com/fcm/send/alice-11');
delete from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/alice-11';
select public.unregister_push('https://fcm.googleapis.com/fcm/send/alice-10');
select is((select count(*)::int from public.push_subscriptions), 8, 'push: unregister_push removes the caller''s own device');
reset role;
select is(
  (select count(*)::int from public.push_subscriptions where user_id = :'ub'), 1,
  'push IDOR: alice''s unregister and delete left bob''s device untouched'
);

-- Config + prune (the Edge Function's anon-key path)
set local role authenticated;
select throws_ok(
  $$ select public.set_push_config('https://evil.example.com/x', repeat('s', 40)) $$,
  '42501', null, 'push: a signed-in user cannot change the push config'
);
select throws_ok($$ select * from private.push_config $$, '42501', null, 'push: a signed-in user cannot read the dispatch secret');
select throws_ok(
  $$ select public.prune_push_subscriptions('anything', array['https://fcm.googleapis.com/fcm/send/alice-09']) $$,
  '42501', 'FORBIDDEN', 'push: prune is refused while no secret is configured'
);
reset role;
select throws_ok(
  $$ select public.set_push_config('http://127.0.0.1:9/push', 'short') $$,
  '22023', 'BAD_SECRET', 'push: the dispatch secret must be at least 32 characters'
);
select public.set_push_config(:'purl', :'psecret');
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$ select public.prune_push_subscriptions('wrong-secret-wrong-secret-wrong-secret', array['https://fcm.googleapis.com/fcm/send/alice-09']) $$,
  '42501', 'FORBIDDEN', 'push: prune with a wrong secret is refused'
);
select is(
  public.prune_push_subscriptions(:'psecret', array['https://fcm.googleapis.com/fcm/send/alice-09', 'https://fcm.googleapis.com/fcm/send/unknown']), 1,
  'push: prune with the dispatch secret deletes the dead endpoints'
);
reset role;
select is((select count(*)::int from public.push_subscriptions where user_id = :'ua'), 7, 'push: the pruned device is gone');

-- Dispatcher. The window is [Istanbul now - 5 min, now] (clamped at midnight) and now() is fixed for
-- the whole transaction, so these reminder times are deterministic: r_in is inside (now - 1 min, or
-- 00:00 in the first minute of the day), r_out is outside (now + 2 min, or now - 10 min after 23:58).
select (case when lt >= time '00:01' then lt - interval '1 minute' else time '00:00' end)::text as r_in,
       (case when lt < time '23:58' then lt + interval '2 minutes' else lt - interval '10 minutes' end)::text as r_out,
       extract(isodow from d)::int as dow,
       extract(isodow from d)::int % 7 + 1 as other_dow
  from (select (now() at time zone 'Europe/Istanbul')::time as lt, (now() at time zone 'Europe/Istanbul')::date as d) x \gset
\set bh1 '00000000-0000-0000-0000-000000000401'
\set bh2 '00000000-0000-0000-0000-000000000402'
\set bh3 '00000000-0000-0000-0000-000000000403'
\set bh4 '00000000-0000-0000-0000-000000000404'
\set bh5 '00000000-0000-0000-0000-000000000405'
\set bh6 '00000000-0000-0000-0000-000000000406'
\set bh7 '00000000-0000-0000-0000-000000000407'
\set bq1 '00000000-0000-0000-0000-000000000408'
\set bq2 '00000000-0000-0000-0000-000000000409'
\set bt1 '00000000-0000-0000-0000-000000000411'
\set bt2 '00000000-0000-0000-0000-000000000412'
\set bt3 '00000000-0000-0000-0000-000000000413'
\set bt4 '00000000-0000-0000-0000-000000000414'
\set bt5 '00000000-0000-0000-0000-000000000415'
\set bt6 '00000000-0000-0000-0000-000000000416'
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
insert into public.habits (id, user_id, name, rule, target_count, remind_at, archived_at) values
  (:'bh1', :'ub', 'A esneme', '{"type":"daily"}', 1, :'r_in', null),                                               -- due
  (:'bh2', :'ub', 'B kitap', '{"type":"daily"}', 3, :'r_in', null),                                                -- 2 of 3: due
  (:'bh3', :'ub', 'Z bitti', '{"type":"daily"}', 1, :'r_in', null),                                                -- done today
  (:'bh4', :'ub', 'Z baska gun', jsonb_build_object('type', 'weekly', 'days', jsonb_build_array(:other_dow)), 1, :'r_in', null), -- not today
  (:'bh5', :'ub', 'Z sonra', '{"type":"daily"}', 1, :'r_out', null),                                               -- outside the window
  (:'bh6', :'ub', 'Z arsiv', '{"type":"daily"}', 1, :'r_in', now());                                               -- archived
insert into public.habit_logs (user_id, habit_id, day, count) values (:'ub', :'bh2', current_date, 2), (:'ub', :'bh3', current_date, 1);
insert into public.todos (id, user_id, title, due_on, rule, starts_on, remind_at, archived_at) values
  (:'bt1', :'ub', 'C fatura', current_date, null, current_date, :'r_in', null),                                    -- one-off due today
  (:'bt2', :'ub', 'D rapor', null, jsonb_build_object('type', 'weekly', 'days', jsonb_build_array(:dow)), current_date - 14, :'r_in', null), -- occurrence
  (:'bt3', :'ub', 'Z odendi', current_date, null, current_date, :'r_in', null),                                    -- completed
  (:'bt4', :'ub', 'Z yarin', current_date + 1, null, current_date, :'r_in', null),                                 -- due tomorrow
  (:'bt5', :'ub', 'Z gunluk', null, '{"type":"daily"}', current_date - 3, :'r_in', null),                          -- today's occurrence done
  (:'bt6', :'ub', 'Z durdu', null, '{"type":"daily"}', current_date - 3, :'r_in', now());                          -- archived
insert into public.todo_completions (user_id, todo_id, day) values (:'ub', :'bt3', current_date), (:'ub', :'bt5', current_date);
reset role;
select is(public.dispatch_reminders(), 1, 'push: one message is queued for bob''s single device');
select is(
  (select convert_from(q.body, 'UTF8')::jsonb from net.http_request_queue q where q.url = :'purl'),
  jsonb_build_object('messages', jsonb_build_array(jsonb_build_object(
    'endpoint', 'https://fcm.googleapis.com/fcm/send/alice-11', 'p256dh', :'pk', 'auth', :'pa',
    'payload', jsonb_build_object('body', 'A esneme, B kitap, C fatura +1', 'url', '/track', 'tag', 'reminders-' || current_date::text)))),
  'push: the batch carries the device keys and a grouped body (3 names + count)'
);
select ok(
  (select q.method = 'POST' and q.headers ->> 'x-dispatch-secret' = :'psecret' from net.http_request_queue q where q.url = :'purl'),
  'push: the request is a POST with the dispatch secret header'
);
select is(
  (select array_agg(split_part(ref, '@', 1) order by ref) from private.reminder_log where user_id = :'ub' and day = current_date),
  array['habit:' || :'bh1', 'habit:' || :'bh2', 'todo:' || :'bt1', 'todo:' || :'bt2'],
  'push: exactly the due, unfinished habits and to-dos are logged'
);
select is(
  (select count(*)::int from private.reminder_log where split_part(ref, '@', 1) in ('habit:' || :'bh3', 'habit:' || :'bh4', 'habit:' || :'bh5', 'habit:' || :'bh6')),
  0, 'push: done, not-due-today, out-of-window and archived habits are not reminded'
);
select is(
  (select count(*)::int from private.reminder_log where split_part(ref, '@', 1) in ('todo:' || :'bt3', 'todo:' || :'bt4', 'todo:' || :'bt5', 'todo:' || :'bt6')),
  0, 'push: completed, not-yet-due and archived to-dos are not reminded'
);
select is(public.dispatch_reminders(), 0, 'push: a second run in the same window queues nothing (reminder_log dedupe)');
select is((select count(*)::int from net.http_request_queue where url = :'purl'), 1, 'push: and adds no request');
select ok(
  (select last_used_at is not null from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/alice-11'),
  'push: the targeted device is stamped last_used_at'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
insert into public.habits (id, user_id, name, remind_at) values (:'bh7', :'ub', 'E yeni', :'r_in');
reset role;
select is(public.dispatch_reminders(), 1, 'push: a newly due item is still sent after the others were');
select is(
  (select convert_from(q.body, 'UTF8')::jsonb #>> '{messages,0,payload,body}' from net.http_request_queue q where q.url = :'purl' order by q.id desc limit 1),
  'E yeni', 'push: and only that item is in the new message'
);

-- weekly_count: reminded only while the ISO week's quota is open (fixed past week: Mon 2026-10-26 done)
set local role authenticated;
insert into public.habits (id, user_id, name, rule, starts_on, remind_at) values
  (:'bq1', :'ub', 'Q bir', '{"type":"weekly_count","n":1}', '2026-10-19', '12:00'),
  (:'bq2', :'ub', 'Q iki', '{"type":"weekly_count","n":2}', '2026-10-19', '12:00');
insert into public.habit_logs (user_id, habit_id, day) values (:'ub', :'bq1', '2026-10-26'), (:'ub', :'bq2', '2026-10-26'), (:'ub', :'bq2', '2026-10-25');
reset role;
select is(
  (select array_agg(split_part(ref, '@', 1) order by ref) from private.reminders_due('2026-10-28', '11:55', '12:00') where split_part(ref, '@', 1) in ('habit:' || :'bq1', 'habit:' || :'bq2')),
  array['habit:' || :'bq2'],
  'push: weekly_count habits are reminded only while the week''s quota is open (last week''s days do not count)'
);
select is(
  (select ref from private.reminders_due('2026-10-28', '11:55', '12:00') where split_part(ref, '@', 1) = 'habit:' || :'bq2'),
  'habit:' || :'bq2' || '@12:00', 'push: the dedupe key carries the reminder time'
);
update public.habits set remind_at = '11:58' where id = :'bq2';
select is(
  (select ref from private.reminders_due('2026-10-28', '11:55', '12:00') where split_part(ref, '@', 1) = 'habit:' || :'bq2'),
  'habit:' || :'bq2' || '@11:58', 'push: moving the reminder time re-arms it (new key, sent again the same day)'
);

-- Blocked users and users without a device get nothing (and nothing is logged for them)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
update public.profiles set is_blocked = true where user_id = :'ub';
set local request.jwt.claims = '';
insert into public.habits (user_id, name, remind_at) values (:'ub', 'F engelli', :'r_in');
select is(public.dispatch_reminders(), 0, 'push: a blocked user gets no reminders');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
update public.profiles set is_blocked = false where user_id = :'ub';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
delete from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/alice-11';
select is((select count(*)::int from public.push_subscriptions), 0, 'push: the owner can delete his own device');
reset role;
select is(public.dispatch_reminders(), 0, 'push: a user without a device gets no message');
select is(
  (select count(*)::int from private.reminder_log where user_id = :'ub' and ref like 'habit:%' and day = current_date), 3,
  'push: and his due items are not logged (they go out once he subscribes)'
);
set local request.jwt.claims = '';

-- =============================================================================
-- Catalog v2: new sources, media columns, replace/retire RPCs (service_role only)
-- =============================================================================
\set cv_old '00000000-0000-0000-0000-00000000cc01'
\set cv_new '00000000-0000-0000-0000-00000000cc02'
\set cv_wg  '00000000-0000-0000-0000-00000000cc03'
\set cv_ret '00000000-0000-0000-0000-00000000cc04'
\set cv_del '00000000-0000-0000-0000-00000000cc05'
\set cv_cus '00000000-0000-0000-0000-00000000cc06'
\set cv_t1  '00000000-0000-0000-0000-00000000cc11'
\set cv_t2  '00000000-0000-0000-0000-00000000cc12'
\set cv_s1  '00000000-0000-0000-0000-00000000cc21'
\set cv_se1 '00000000-0000-0000-0000-00000000cc22'
\set cv_se2 '00000000-0000-0000-0000-00000000cc23'
reset role;
set local request.jwt.claims = '';

-- source check: the new sources are accepted, anything else is not
select lives_ok(
  $$ insert into public.exercises (id, external_id, source, name_en, media_frames, instructions_en) values
       ('00000000-0000-0000-0000-00000000cc01', 'wger:cv-old', 'wger', 'Old Row', '{frames/cv-old/1.svg}', '{pull}'),
       ('00000000-0000-0000-0000-00000000cc02', 'wger:cv-new', 'wger', 'Barbell Row', '{}', '{pull}'),
       ('00000000-0000-0000-0000-00000000cc03', 'wg:cv-row', 'workout-guide', 'Cable Row', '{}', '{}'),
       ('00000000-0000-0000-0000-00000000cc04', 'wger:cv-ret', 'wger', 'Retired Curl', '{frames/cv-ret/1.svg}', '{curl}'),
       ('00000000-0000-0000-0000-00000000cc05', 'wger:cv-del', 'legacy', 'Unused Curl', '{}', '{}') $$,
  'catalog v2: source check accepts wger, workout-guide and legacy'
);
select throws_ok(
  $$ insert into public.exercises (external_id, source, name_en) values ('x-cv-bad', 'exercisedb', 'Bad') $$,
  '23514', null, 'catalog v2: the removed exercisedb source (and any unknown one) is rejected'
);
update public.exercises set media_frames = '{frames/cable-row/1.svg,frames/cable-row/2.svg}',
       attribution = '{"text":{"author":"Bryl Lim","license":"MIT"},"changes":[]}', instructions_tr = '{pull}'
 where id in (:'cv_wg', :'cv_ret');
select throws_ok(
  $$ update public.exercises set attribution = '"just text"' where id = '00000000-0000-0000-0000-00000000cc03' $$,
  '23514', null, 'catalog v2: attribution must be a JSON object'
);

-- read policy: wger / workout-guide / legacy rows are catalog rows; custom media rules still hold
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
select is(
  (select array_agg(source order by source) from public.exercises where id in (:'cv_new', :'cv_wg', :'cv_del')),
  array['legacy', 'wger', 'workout-guide'], 'catalog v2: signed-in users read wger, workout-guide and legacy rows'
);
insert into public.exercises (id, source, name_en, is_custom, user_id, media_frames, attribution)
values (:'cv_cus', 'wger', 'My Row', false, :'ub', '{frames/cable-row/1.svg}', '{"text":{"author":"me"}}');
select is(
  (select source || ':' || cardinality(media_frames) || ':' || coalesce(attribution::text, 'null') from public.exercises where id = :'cv_cus'),
  'custom:0:null', 'catalog v2: a custom exercise cannot claim a source, catalog frames or a credit line'
);
update public.exercises set media_frames = '{frames/cable-row/2.svg}' where id = :'cv_cus';
select is((select cardinality(media_frames) from public.exercises where id = :'cv_cus'), 0, 'catalog v2: a custom exercise cannot be pointed at catalog frames later');
update public.exercises set media_frames = '{}' where id = :'cv_wg';
select is((select cardinality(media_frames) from public.exercises where id = :'cv_wg'), 2, 'catalog v2: clients cannot edit catalog frames');

-- ExerciseDB media ids (20261200000000): written by service_role only, validated by checks
reset role;
set local request.jwt.claims = '';
select has_column('public', 'exercises', 'exercisedb_id', 'exercisedb: exercises.exercisedb_id exists');
select has_column('public', 'exercises', 'exercisedb_match', 'exercisedb: exercises.exercisedb_match exists');
select has_index('public', 'exercises', 'exercises_exercisedb_unmatched_idx', 'exercisedb: the unmatched-list index exists');
select lives_ok(
  $$ update public.exercises set exercisedb_id = '0br45wL', exercisedb_match = 'exact' where id = '00000000-0000-0000-0000-00000000cc03' $$,
  'exercisedb: service role sets an id with its match kind'
);
select throws_ok(
  $$ update public.exercises set exercisedb_id = 'bad-id!', exercisedb_match = 'manual' where id = '00000000-0000-0000-0000-00000000cc02' $$,
  '23514', null, 'exercisedb: an id with non-alphanumeric characters is rejected'
);
select throws_ok(
  $$ update public.exercises set exercisedb_id = 'abc', exercisedb_match = 'manual' where id = '00000000-0000-0000-0000-00000000cc02' $$,
  '23514', null, 'exercisedb: an id shorter than 4 characters is rejected'
);
select throws_ok(
  $$ update public.exercises set exercisedb_id = 'abcd1234', exercisedb_match = 'guess' where id = '00000000-0000-0000-0000-00000000cc02' $$,
  '23514', null, 'exercisedb: an unknown match kind is rejected'
);
select throws_ok(
  $$ update public.exercises set exercisedb_id = 'abcd1234' where id = '00000000-0000-0000-0000-00000000cc02' $$,
  '23514', null, 'exercisedb: an id without a match kind is rejected'
);
select throws_ok(
  $$ update public.exercises set exercisedb_match = 'manual' where id = '00000000-0000-0000-0000-00000000cc02' $$,
  '23514', null, 'exercisedb: a match kind without an id is rejected'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
update public.exercises set exercisedb_id = 'HACKED99', exercisedb_match = 'manual' where id = :'cv_wg';
select is(
  (select exercisedb_id || ':' || exercisedb_match from public.exercises where id = :'cv_wg'),
  '0br45wL:exact', 'exercisedb: an authenticated user cannot change exercisedb_id on a catalog row'
);
update public.exercises set exercisedb_id = 'abcd1234', exercisedb_match = 'manual' where id = :'cv_cus';
select is(
  (select coalesce(exercisedb_id, 'null') || ':' || coalesce(exercisedb_match, 'null') from public.exercises where id = :'cv_cus'),
  'null:null', 'exercisedb: a custom exercise cannot be pointed at ExerciseDB media'
);

-- Both RPCs are service_role only
select ok(
  not has_function_privilege('anon', 'public.replace_catalog_exercise(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.replace_catalog_exercise(uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.replace_catalog_exercise(uuid, uuid)', 'execute'),
  'catalog v2: replace_catalog_exercise is executable by service_role only'
);
select ok(
  not has_function_privilege('anon', 'public.retire_catalog_exercise(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.retire_catalog_exercise(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.retire_catalog_exercise(uuid)', 'execute'),
  'catalog v2: retire_catalog_exercise is executable by service_role only'
);
select throws_ok(
  $$ select public.replace_catalog_exercise('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-00000000cc02') $$,
  '42501', null, 'catalog v2: a signed-in user cannot call replace_catalog_exercise'
);
select throws_ok(
  $$ select public.retire_catalog_exercise('00000000-0000-0000-0000-00000000cc04') $$,
  '42501', null, 'catalog v2: a signed-in user cannot call retire_catalog_exercise'
);
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$ select public.retire_catalog_exercise('00000000-0000-0000-0000-00000000cc05') $$,
  '42501', null, 'catalog v2: anon cannot call retire_catalog_exercise'
);

-- Bob's history on the old exercise: template t1 holds old + new (collision), t2 only old; one session
-- with two sets; PRs on two days, the later day colliding with a better PR on the new exercise.
reset role;
set local request.jwt.claims = '';
insert into public.workout_templates (id, user_id, name) values (:'cv_t1', :'ub', 'Pull A'), (:'cv_t2', :'ub', 'Pull B');
insert into public.template_exercises (template_id, user_id, exercise_id, position, target_sets) values
  (:'cv_t1', :'ub', :'cv_old', 1, 4), (:'cv_t1', :'ub', :'cv_new', 2, 3), (:'cv_t2', :'ub', :'cv_old', 1, 5);
insert into public.workout_sessions (id, user_id, kind, started_at, ended_at)
values (:'cv_s1', :'ub', 'strength', now() - interval '1 day', null);
insert into public.session_exercises (id, session_id, user_id, exercise_id, position) values
  (:'cv_se1', :'cv_s1', :'ub', :'cv_old', 1), (:'cv_se2', :'cv_s1', :'ub', :'cv_ret', 2);
insert into public.session_sets (session_exercise_id, session_id, user_id, set_no, weight_kg, reps) values
  (:'cv_se1', :'cv_s1', :'ub', 1, 80, 8), (:'cv_se1', :'cv_s1', :'ub', 2, 80, 8), (:'cv_se2', :'cv_s1', :'ub', 1, 20, 10);
insert into public.personal_records (user_id, exercise_id, weight_kg, reps, e1rm, achieved_on) values
  (:'ub', :'cv_old', 70, 8, 88.67, current_date - 2),
  (:'ub', :'cv_old', 80, 8, 101.33, current_date - 1),
  (:'ub', :'cv_new', 85, 8, 107.67, current_date - 1);   -- same day, better, a silent baseline (no award)
select public.award_points(:'ub', 'personal_record', current_date - 2, 'personal_records', :'cv_old' || ':' || (current_date - 2)::text);
select public.award_points(:'ub', 'personal_record', current_date - 1, 'personal_records', :'cv_old' || ':' || (current_date - 1)::text);
create temp table t_cv as
  select (select total_points from public.profiles where user_id = :'ub') as total_before,
         (select points from public.point_events where user_id = :'ub' and ref_table = 'personal_records'
            and ref_id = :'cv_old' || ':' || (current_date - 1)::text) as day1_points,
         (select count(*)::int from public.point_events where user_id = :'ub') as events_before,
         null::jsonb as r;
grant all on t_cv to service_role;
select ok((select day1_points > 0 from t_cv), 'catalog v2 fixture: the old exercise''s PR earned points');

select throws_like(
  $$ select public.replace_catalog_exercise('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-00000000cc06') $$,
  '%NOT_CATALOG%', 'catalog v2: replace refuses a custom exercise as target'
);
select throws_like(
  $$ select public.replace_catalog_exercise('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-00000000cc05') $$,
  '%TARGET_IS_LEGACY%', 'catalog v2: replace refuses a legacy row as target'
);
set local role service_role;
update t_cv set r = public.replace_catalog_exercise(:'cv_old', :'cv_new');
reset role;
select is((select count(*)::int from public.exercises where id = :'cv_old'), 0, 'replace: the old exercise is deleted');
select is(
  (select array_agg(t.name || ':' || te.position || ':' || te.target_sets order by t.name, te.position)
     from public.template_exercises te join public.workout_templates t on t.id = te.template_id
    where te.template_id in (:'cv_t1', :'cv_t2') and te.exercise_id = :'cv_new'),
  array['Pull A:2:3', 'Pull B:1:5'],
  'replace: template entries move to the new exercise; a template that already had it keeps its own entry'
);
select is((select count(*)::int from public.template_exercises where template_id in (:'cv_t1', :'cv_t2')), 2, 'replace: no duplicate entry in the colliding template');
select is((select exercise_id from public.session_exercises where id = :'cv_se1'), :'cv_new'::uuid, 'replace: the session exercise is repointed');
select is(
  (select count(*)::int from public.session_sets ss join public.session_exercises se on se.id = ss.session_exercise_id
    where se.exercise_id = :'cv_new' and ss.session_id = :'cv_s1'),
  2, 'replace: the logged sets follow their session exercise'
);
select is(
  (select array_agg(achieved_on::text || ':' || e1rm order by achieved_on) from public.personal_records where user_id = :'ub' and exercise_id = :'cv_new'),
  array[(current_date - 2)::text || ':88.67', (current_date - 1)::text || ':107.67'],
  'replace: PRs move; on a same-day collision the better record survives'
);
select is(
  (select array_agg(ref_id order by ref_id) from public.point_events
    where user_id = :'ub' and ref_table = 'personal_records' and ref_id like '00000000-0000-0000-0000-00000000cc0%'),
  array[:'cv_new' || ':' || (current_date - 2)::text, :'cv_new' || ':' || (current_date - 1)::text],
  'replace: PR awards are re-keyed to the new exercise (no old refs left)'
);
select is(
  (select points from public.point_events where user_id = :'ub' and ref_table = 'personal_records' and ref_id = :'cv_new' || ':' || (current_date - 1)::text),
  (select day1_points from t_cv),
  'replace: the surviving record takes over the larger same-day award'
);
select is((select total_points from public.profiles where user_id = :'ub'), (select total_before from t_cv), 'replace: no points are awarded or lost');
select is((select count(*)::int from public.point_events where user_id = :'ub'), (select events_before from t_cv), 'replace: no point event is added');
select is(
  (select r from t_cv),
  '{"template_entries_repointed": 1, "template_entries_dropped": 1, "session_exercises_repointed": 1,
    "personal_records_repointed": 1, "personal_records_merged": 1}'::jsonb,
  'replace: the result reports what was dropped and merged'
);
delete from public.personal_records where user_id = :'ub' and exercise_id = :'cv_new' and achieved_on = current_date - 1;
select is(
  (select total_points from public.profiles where user_id = :'ub'), (select total_before - day1_points from t_cv),
  'replace: deleting a repointed PR still revokes its points'
);

-- retire: referenced -> legacy shell; unreferenced -> deleted
set local role service_role;
select is(public.retire_catalog_exercise(:'cv_ret'), 'retired', 'retire: a referenced exercise is kept');
select is(public.retire_catalog_exercise(:'cv_del'), 'deleted', 'retire: an unreferenced exercise is deleted');
reset role;
select is(
  (select source || ':' || name_en || ':' || cardinality(instructions_en) || ':'
          || coalesce(instructions_tr::text, 'null') || ':' || cardinality(media_frames) from public.exercises where id = :'cv_ret'),
  'legacy:Retired Curl:0:null:0', 'retire: the kept row is legacy with media and instructions cleared'
);
select is((select count(*)::int from public.exercises where id = :'cv_del'), 0, 'retire: the unreferenced row is gone');
select is((select exercise_id from public.session_exercises where id = :'cv_se2'), :'cv_ret'::uuid, 'retire: history still points at the legacy row');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
select is((select name_en from public.exercises where id = :'cv_ret'), 'Retired Curl', 'retire: the legacy row stays readable for history');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select is((select count(*)::int from public.template_exercises where template_id in (:'cv_t1', :'cv_t2')), 0, 'catalog v2: alice sees none of bob''s repointed template entries');
reset role;
set local request.jwt.claims = '';

-- =============================================================================
-- Faz 4: badges, admin panel, week summary, AI coach
-- =============================================================================
\set uc '00000000-0000-0000-0000-00000000000c'
\set ud '00000000-0000-0000-0000-00000000000d'
\set jwt_a '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}'
\set jwt_b '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}'
\set jwt_c '{"sub":"00000000-0000-0000-0000-00000000000c","email":"carol@example.com","role":"authenticated"}'
\set jwt_d '{"sub":"00000000-0000-0000-0000-00000000000d","email":"dave@example.com","role":"authenticated"}'
\set cs1  '00000000-0000-0000-0000-000000000501'
\set cs2  '00000000-0000-0000-0000-000000000502'
\set cs3  '00000000-0000-0000-0000-000000000503'
\set cse1 '00000000-0000-0000-0000-000000000511'
\set cse2 '00000000-0000-0000-0000-000000000512'
\set cse3 '00000000-0000-0000-0000-000000000513'
\set hc1  '00000000-0000-0000-0000-000000000521'
\set hc2  '00000000-0000-0000-0000-000000000522'
\set hw1  '00000000-0000-0000-0000-000000000531'
\set hw2  '00000000-0000-0000-0000-000000000532'
\set hw3  '00000000-0000-0000-0000-000000000533'
\set hw4  '00000000-0000-0000-0000-000000000534'
\set hw5  '00000000-0000-0000-0000-000000000535'
\set tw1  '00000000-0000-0000-0000-000000000536'
\set tw2  '00000000-0000-0000-0000-000000000537'
\set tw3  '00000000-0000-0000-0000-000000000538'
\set conv1 '00000000-0000-0000-0000-000000000541'
\set conv2 '00000000-0000-0000-0000-000000000542'

-- Carol (approved, clean slate) and Dave (stays pending)
reset role;
set local request.jwt.claims = '';
insert into auth.users (id, email, instance_id, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  (:'uc', 'carol@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}', '{}', now(), now()),
  (:'ud', 'dave@example.com',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}', '{}', now(), now());
set local role authenticated;
set local request.jwt.claims = :'jwt_c';
insert into public.profiles (user_id, username, display_name, avatar_path, onboarding_completed_at)
values (:'uc', 'carol', 'Carol', '00000000-0000-0000-0000-00000000000c/avatar.jpg', now());
set local request.jwt.claims = :'jwt_d';
insert into public.profiles (user_id, username, display_name, avatar_path, onboarding_completed_at)
values (:'ud', 'dave', 'Dave', '00000000-0000-0000-0000-00000000000d/avatar.jpg', now());
set local request.jwt.claims = :'jwt_a';
select public.admin_set_registration_status(:'uc', 'approved');

reset role;
select ok(
  not has_function_privilege('authenticated', 'public.check_badges(uuid, text[])', 'execute')
  and not has_function_privilege('anon', 'public.check_badges(uuid, text[])', 'execute')
  and not has_function_privilege('authenticated', 'public.badges_after_activity()', 'execute')
  and not has_function_privilege('authenticated', 'public.ai_conversations_guard()', 'execute')
  and not has_function_privilege('authenticated', 'public.ai_messages_guard()', 'execute')
  and not has_function_privilege('authenticated', 'public.ai_messages_touch()', 'execute'),
  'faz4: badge awarding and the AI coach trigger functions are internal'
);
select ok(
  not has_function_privilege('anon', 'public.get_week_summary(date)', 'execute')
  and not has_function_privilege('anon', 'public.get_coach_context()', 'execute')
  and not has_function_privilege('anon', 'public.habit_due_done(date, date)', 'execute')
  and (select bool_and(not p.prosecdef and 'TimeZone=Europe/Istanbul' = any (p.proconfig)) from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname in ('get_week_summary', 'get_coach_context', 'habit_due_done')),
  'faz4: week summary and coach context run as the caller on Istanbul time, never for anon'
);
select is(
  (select array_agg(code order by sort) from public.badges),
  array['first_workout', 'workouts_10', 'workouts_50', 'workouts_100', 'workouts_250', 'streak_7', 'streak_30', 'streak_100',
        'streak_365', 'sets_100', 'sets_500', 'sets_1000', 'sets_5000', 'volume_10t', 'volume_100t', 'volume_1000t', 'pr_10',
        'pr_50', 'cardio_600', 'cardio_3000', 'early_bird_5', 'weekend_10', 'habit_30', 'habit_100', 'habit_365', 'todo_50',
        'todo_200', 'water_30', 'sleep_30', 'weigh_30', 'photos_10', 'photos_25'],
  'badges: the badges are seeded in display order'
);
select is((select count(*)::int from public.badges), 32, 'badges: public.badges has 32 rows');

-- badges: workouts ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'jwt_c';
insert into public.workout_sessions (id, user_id, kind, started_at) values (:'cs1', :'uc', 'strength', greatest(now() - interval '40 minutes', date_trunc('day', now())));
insert into public.session_exercises (id, session_id, user_id, exercise_id, position) values (:'cse1', :'cs1', :'uc', :'ex1', 1);
insert into public.session_sets (session_exercise_id, session_id, user_id, set_no, weight_kg, reps)
  select :'cse1', :'cs1', :'uc', g, 50, 5 from generate_series(1, 3) g;
select is((select count(*)::int from public.user_badges), 0, 'badges: nothing is earned before a session is finished');
select public.finish_workout_session(:'cs1');
select is((select array_agg(badge_code) from public.user_badges), array['first_workout'], 'badges: the first finished session earns first_workout');
-- bulk: 96 working sets + 10 warm-ups -> 99 working sets so far
insert into public.workout_sessions (id, user_id, kind, started_at) values (:'cs2', :'uc', 'strength', greatest(now() - interval '30 minutes', date_trunc('day', now())));
insert into public.session_exercises (id, session_id, user_id, exercise_id, position) values (:'cse2', :'cs2', :'uc', :'ex1', 1);
insert into public.session_sets (session_exercise_id, session_id, user_id, set_no, weight_kg, reps, is_warmup)
  select :'cse2', :'cs2', :'uc', g, 40, 8, g > 96 from generate_series(1, 106) g;
select public.finish_workout_session(:'cs2');
select ok(not exists (select 1 from public.user_badges where badge_code = 'sets_100'), 'badges: 99 working sets (warm-ups excluded) are not yet sets_100');
insert into public.workout_sessions (id, user_id, kind, started_at) values (:'cs3', :'uc', 'strength', greatest(now() - interval '20 minutes', date_trunc('day', now())));
insert into public.session_exercises (id, session_id, user_id, exercise_id, position) values (:'cse3', :'cs3', :'uc', :'ex1', 1);
insert into public.session_sets (session_exercise_id, session_id, user_id, set_no, weight_kg, reps) values (:'cse3', :'cs3', :'uc', 1, 60, 5);
select public.finish_workout_session(:'cs3');
select ok(exists (select 1 from public.user_badges where badge_code = 'sets_100'), 'badges: the 100th working set earns sets_100');
select throws_ok(
  $$ insert into public.user_badges (user_id, badge_code) values ('00000000-0000-0000-0000-00000000000c', 'todo_50') $$,
  '42501', null, 'badges: clients cannot award themselves a badge'
);
update public.user_badges set earned_at = now() - interval '1 year';
delete from public.user_badges;
select is((select count(*)::int from public.user_badges where earned_at = now()), 3, 'badges: clients cannot edit or delete their badges');
delete from public.workout_sessions where id = :'cs2';
select is((select count(*)::int from public.user_badges), 3, 'badges: deleting the source session does not revoke a milestone');
select is((select count(*)::int from public.point_events where ref_table = 'user_badges' or kind like 'badge%'), 0, 'badges: badges give no points');

-- badges: streak, photos, habits, to-dos (direct fixtures as the owner role) ----------------------
reset role;
set local request.jwt.claims = '';
select set_config('app.internal', 'on', true);
update public.profiles set current_streak = 6, longest_streak = 6 where user_id = :'uc';
select ok(not exists (select 1 from public.user_badges where user_id = :'uc' and badge_code like 'streak%'), 'badges: a 6-day streak earns no streak badge');
update public.profiles set current_streak = 7, longest_streak = 7 where user_id = :'uc';
select is((select array_agg(badge_code) from public.user_badges where user_id = :'uc' and badge_code like 'streak%'), array['streak_7'], 'badges: reaching a 7-day streak earns streak_7');
update public.profiles set current_streak = 30, longest_streak = 30 where user_id = :'uc';
select is((select array_agg(badge_code order by badge_code) from public.user_badges where user_id = :'uc' and badge_code like 'streak%'), array['streak_30', 'streak_7'], 'badges: reaching 30 days earns streak_30');
update public.profiles set current_streak = 1 where user_id = :'uc';
select set_config('app.internal', 'off', true);

create temp table t_ph as select g as n, gen_random_uuid() as id from generate_series(1, 10) g;
insert into storage.objects (bucket_id, name)
  select 'progress-photos', :'uc' || '/' || p.id || v.suffix from t_ph p, (values ('.img.bin'), ('.thumb.bin')) v(suffix);
insert into public.progress_photos (id, user_id, taken_on, pose, image_path, thumb_path, image_iv, thumb_iv)
  select p.id, :'uc', current_date - p.n, 'front', :'uc' || '/' || p.id || '.img.bin', :'uc' || '/' || p.id || '.thumb.bin', repeat('i', 16), repeat('t', 16)
  from t_ph p where p.n <= 9;
select ok(not exists (select 1 from public.user_badges where user_id = :'uc' and badge_code = 'photos_10'), 'badges: 9 progress photos are not yet photos_10');
insert into public.progress_photos (id, user_id, taken_on, pose, image_path, thumb_path, image_iv, thumb_iv)
  select p.id, :'uc', current_date - p.n, 'side', :'uc' || '/' || p.id || '.img.bin', :'uc' || '/' || p.id || '.thumb.bin', repeat('i', 16), repeat('t', 16)
  from t_ph p where p.n = 10;
select ok(exists (select 1 from public.user_badges where user_id = :'uc' and badge_code = 'photos_10'), 'badges: the 10th progress photo earns photos_10');

insert into public.habits (id, user_id, name, starts_on) values (:'hc1', :'uc', 'Esneme', current_date - 40);
insert into public.habits (id, user_id, name, target_count, starts_on) values (:'hc2', :'uc', 'Sayfa', 3, current_date - 40);
insert into public.habit_logs (user_id, habit_id, day, count) select :'uc', :'hc2', current_date - g, 1 from generate_series(1, 10) g;
insert into public.habit_logs (user_id, habit_id, day) select :'uc', :'hc1', current_date - g from generate_series(1, 29) g;
select ok(not exists (select 1 from public.user_badges where user_id = :'uc' and badge_code = 'habit_30'), 'badges: 29 completed habit-days (and 10 below target) are not yet habit_30');
insert into public.habit_logs (user_id, habit_id, day) values (:'uc', :'hc1', current_date);
select ok(exists (select 1 from public.user_badges where user_id = :'uc' and badge_code = 'habit_30'), 'badges: the 30th completed habit-day earns habit_30');

insert into public.todos (user_id, title) select :'uc', 'is ' || g from generate_series(1, 50) g;
insert into public.todo_completions (user_id, todo_id, day) select :'uc', t.id, current_date from public.todos t where t.user_id = :'uc' and t.title like 'is %' and t.title <> 'is 50';
select ok(not exists (select 1 from public.user_badges where user_id = :'uc' and badge_code = 'todo_50'), 'badges: 49 completed to-dos are not yet todo_50');
insert into public.todo_completions (user_id, todo_id, day) select :'uc', t.id, current_date from public.todos t where t.user_id = :'uc' and t.title = 'is 50';
select ok(exists (select 1 from public.user_badges where user_id = :'uc' and badge_code = 'todo_50'), 'badges: the 50th completed to-do earns todo_50');

select is(public.check_badges(:'uc'), '{}'::text[], 'badges: check_badges is idempotent (a full re-check earns nothing new)');
select is((select count(*)::int from public.user_badges where user_id = :'uc'), 8, 'badges: and adds no duplicate rows');

-- get_user_badges privacy
insert into public.user_badges (user_id, badge_code) values (:'ud', 'first_workout');
set local role authenticated;
set local request.jwt.claims = :'jwt_b';
select is((select count(*)::int from public.user_badges where user_id = :'uc'), 0, 'badges IDOR: bob reads none of carol''s badge rows');
select is((select count(*)::int from public.get_user_badges(:'uc')), 8, 'badges: get_user_badges shows a leaderboard user''s badges');
select is((select count(*)::int from public.get_user_badges(:'ud')), 0, 'badges privacy: nothing for a user who is not approved');
set local request.jwt.claims = :'jwt_c';
update public.profiles set show_on_leaderboard = false where user_id = :'uc';
select is((select array_agg(badge_code) from public.get_user_badges(:'uc'))::text[],
  array['first_workout', 'streak_7', 'streak_30', 'sets_100', 'volume_10t', 'habit_30', 'todo_50', 'photos_10'],
  'badges: a hidden user still gets her own badges (in display order)');
select ok((select public.my_badge_progress() ?& array['workouts', 'weigh_ins']), 'badges: my_badge_progress returns the workouts and weigh_ins metrics');
set local request.jwt.claims = :'jwt_d';
select throws_ok($$ select public.my_badge_progress() $$, '42501', 'FORBIDDEN', 'badges: my_badge_progress is FORBIDDEN without access (pending)');
set local request.jwt.claims = :'jwt_c';
set local request.jwt.claims = :'jwt_b';
select is((select count(*)::int from public.get_user_badges(:'uc')), 0, 'badges privacy: nothing for a user hidden from the leaderboard');
set local request.jwt.claims = :'jwt_c';
update public.profiles set show_on_leaderboard = true where user_id = :'uc';

-- admin panel ---------------------------------------------------------------------------------
set local request.jwt.claims = :'jwt_b';
select throws_ok($$ select public.admin_set_config('access_mode', '"invite"') $$, '42501', 'FORBIDDEN', 'admin: non-admins cannot change the config');
select throws_ok($$ select * from public.admin_list_allowed_emails() $$, '42501', 'FORBIDDEN', 'admin: non-admins cannot list the invite list');
select throws_ok($$ select public.admin_add_allowed_email('x@example.com', null) $$, '42501', 'FORBIDDEN', 'admin: non-admins cannot invite');
select throws_ok($$ select public.admin_remove_allowed_email('x@example.com') $$, '42501', 'FORBIDDEN', 'admin: non-admins cannot remove invites');
select throws_ok($$ select * from public.admin_list_users(null, 10) $$, '42501', 'FORBIDDEN', 'admin: non-admins cannot list users');
select throws_ok($$ select public.admin_usage_summary() $$, '42501', 'FORBIDDEN', 'admin: non-admins cannot read the usage summary');
select throws_ok($$ select public.admin_set_blocked('00000000-0000-0000-0000-00000000000c', true) $$, '42501', 'FORBIDDEN', 'admin: non-admins cannot block');
select throws_ok($$ select public.admin_set_ai_limit('00000000-0000-0000-0000-00000000000b', 1000) $$, '42501', 'FORBIDDEN', 'admin: non-admins cannot set AI limits (not even their own)');

set local request.jwt.claims = :'jwt_a';
select lives_ok($$ select public.admin_set_config('access_mode', '"invite"') $$, 'admin: switch to invite mode');
select lives_ok($$ select public.admin_set_config('require_approval', 'false') $$, 'admin: turn approval off');
select lives_ok($$ select public.admin_set_config('ai_global_daily_limit', '150') $$, 'admin: set the app''s daily AI budget');
select is(
  (select jsonb_object_agg(key, value) from public.app_config where key in ('access_mode', 'require_approval', 'ai_global_daily_limit')),
  '{"access_mode": "invite", "require_approval": false, "ai_global_daily_limit": 150}'::jsonb,
  'admin: the config values are stored'
);
select throws_ok($$ select public.admin_set_config('access_mode', '"closed"') $$, '22023', 'BAD_VALUE', 'admin: access_mode is open or invite');
select throws_ok($$ select public.admin_set_config('require_approval', '"yes"') $$, '22023', 'BAD_VALUE', 'admin: require_approval is a boolean');
select throws_ok($$ select public.admin_set_config('ai_global_daily_limit', '10001') $$, '22023', 'BAD_VALUE', 'admin: the AI budget is at most 10000');
select throws_ok($$ select public.admin_set_config('ai_global_daily_limit', '2.5') $$, '22023', 'BAD_VALUE', 'admin: the AI budget is an integer');
select throws_ok($$ select public.admin_set_config('admin_bootstrap_email', '"evil@example.com"') $$, '22023', 'BAD_KEY', 'admin: other keys cannot be set');
select public.admin_set_config('access_mode', '"open"');
select public.admin_set_config('require_approval', 'true');
select public.admin_set_config('ai_global_daily_limit', '200');

select lives_ok($$ select public.admin_add_allowed_email('  New.Friend@Example.COM ', 'gym') $$, 'admin: invite an e-mail');
select is(
  (select email || ':' || note || ':' || added_by_username from public.admin_list_allowed_emails() where email = 'new.friend@example.com'),
  'new.friend@example.com:gym:alice_01', 'admin: invites are stored trimmed and lower-cased, with who added them'
);
select throws_ok($$ select public.admin_add_allowed_email('not-an-email', null) $$, '22023', 'BAD_EMAIL', 'admin: malformed e-mails are rejected');
select is(public.admin_remove_allowed_email('NEW.FRIEND@example.com'), true, 'admin: remove an invite (any case)');
select is(public.admin_remove_allowed_email('new.friend@example.com'), false, 'admin: removing a missing invite reports false');

select is((select email from public.admin_list_users('caro', 10)), 'carol@example.com', 'admin: users are searchable by username and show their e-mail');
select ok((public.admin_usage_summary() ->> 'db_bytes')::bigint > 0 and public.admin_usage_summary() ? 'storage', 'admin: the usage summary reports database and storage size');
select is((select count(*)::int from public.admin_list_users('example.com', 2)), 2, 'admin: search by e-mail, the limit applies');
select is((select count(*)::int from public.admin_list_users('%', 50)), 0, 'admin: LIKE wildcards in the query are literal');
select is((select count(*)::int from public.admin_list_users(null, 50)), 4, 'admin: an empty query lists every user');

select throws_ok($$ select public.admin_set_blocked('00000000-0000-0000-0000-00000000000a', true) $$, 'P0001', 'CANNOT_CHANGE_SELF', 'admin: an admin cannot block themself');
update public.profiles set role = 'admin' where user_id = :'ud';
select throws_ok($$ select public.admin_set_blocked('00000000-0000-0000-0000-00000000000d', true) $$, 'P0001', 'TARGET_IS_ADMIN', 'admin: an admin cannot block another admin');
update public.profiles set role = 'user' where user_id = :'ud';
select throws_ok($$ select public.admin_set_blocked('00000000-0000-0000-0000-0000000000ff', true) $$, 'P0002', 'NOT_FOUND', 'admin: blocking an unknown user fails');
select lives_ok($$ select public.admin_set_blocked('00000000-0000-0000-0000-00000000000c', true) $$, 'admin: block carol');
select is((select is_blocked from public.admin_list_users('carol', 1)), true, 'admin: the block is visible in the user list');
set local request.jwt.claims = :'jwt_c';
select ok(not public.can_access(), 'admin: a blocked user loses access');
set local request.jwt.claims = :'jwt_b';
select is((select count(*)::int from public.get_user_badges(:'uc')), 0, 'badges privacy: nothing for a blocked user');
set local request.jwt.claims = :'jwt_a';
select lives_ok($$ select public.admin_set_blocked('00000000-0000-0000-0000-00000000000c', false) $$, 'admin: unblock carol');
select lives_ok($$ select public.admin_set_ai_limit('00000000-0000-0000-0000-00000000000c', 5) $$, 'admin: set carol''s AI limit');
select is((select ai_daily_limit from public.admin_list_users('carol', 1)), 5, 'admin: the per-user AI limit is stored');
select throws_ok($$ select public.admin_set_ai_limit('00000000-0000-0000-0000-00000000000c', 1001) $$, '22023', 'BAD_VALUE', 'admin: the AI limit is 0..1000');

-- week summary (fixed past week: Monday nine weeks ago, Istanbul) ----------------------------------
reset role;
set local request.jwt.claims = '';
select (date_trunc('week', current_date)::date - 63)::text as wk \gset
select set_config('app.internal', 'on', true);
insert into public.workout_sessions (user_id, kind, started_at, ended_at, duration_sec, total_sets, total_volume_kg) values
  (:'uc', 'strength', (:'wk'::date + time '10:00')::timestamptz, (:'wk'::date + time '11:00')::timestamptz, 3600, 10, 1000.5),
  (:'uc', 'strength', (:'wk'::date + 2 + time '18:00')::timestamptz, (:'wk'::date + 2 + time '18:45')::timestamptz, 2700, 5, 500),
  (:'uc', 'cardio', (:'wk'::date + 3 + time '07:00')::timestamptz, (:'wk'::date + 3 + time '07:31')::timestamptz, 1830, 0, 0),
  (:'uc', 'strength', (:'wk'::date + 4 + time '07:00')::timestamptz, null, null, 0, 0),                                              -- unfinished
  (:'uc', 'strength', (:'wk'::date - 1 + time '23:30')::timestamptz, (:'wk'::date + time '00:30')::timestamptz, 3600, 20, 2000),   -- Sunday before
  (:'uc', 'strength', (:'wk'::date + 7 + time '00:10')::timestamptz, (:'wk'::date + 7 + time '01:00')::timestamptz, 3000, 20, 2000); -- next Monday
select set_config('app.internal', 'off', true);
insert into public.habits (id, user_id, name, rule, target_count, starts_on, archived_at) values
  (:'hw1', :'uc', 'W daily', '{"type":"daily"}', 1, :'wk'::date - 10, null),                                -- 7 due, 3 done
  (:'hw2', :'uc', 'W mon-wed', '{"type":"weekly","days":[1,3]}', 2, :'wk'::date - 10, null),                -- 2 due, 1 done
  (:'hw3', :'uc', 'W 3x', '{"type":"weekly_count","n":3}', 1, :'wk'::date - 10, null),                      -- 3 due, 2 done
  (:'hw4', :'uc', 'W archived', '{"type":"daily"}', 1, :'wk'::date - 10, (:'wk'::date - 1)::timestamptz),   -- not due
  (:'hw5', :'uc', 'W late start', '{"type":"daily"}', 1, :'wk'::date + 5, null);                            -- 2 due, 0 done
insert into public.habit_logs (user_id, habit_id, day, count) values
  (:'uc', :'hw1', :'wk'::date, 1), (:'uc', :'hw1', :'wk'::date + 1, 1), (:'uc', :'hw1', :'wk'::date + 2, 1),
  (:'uc', :'hw2', :'wk'::date, 2), (:'uc', :'hw2', :'wk'::date + 2, 1),
  (:'uc', :'hw3', :'wk'::date + 4, 1), (:'uc', :'hw3', :'wk'::date + 5, 1),
  (:'uc', :'hw4', :'wk'::date + 1, 1);
insert into public.todos (id, user_id, title) values (:'tw1', :'uc', 'W one'), (:'tw2', :'uc', 'W two'), (:'tw3', :'uc', 'W before');
insert into public.todo_completions (user_id, todo_id, day, completed_on) values
  (:'uc', :'tw1', :'wk'::date + 1, :'wk'::date + 1), (:'uc', :'tw2', :'wk'::date + 3, :'wk'::date + 3),
  (:'uc', :'tw3', :'wk'::date - 1, :'wk'::date - 1);
insert into public.sleep_entries (user_id, sleep_on, bed_at, wake_at) values
  (:'uc', :'wk'::date, (:'wk'::date - 1 + time '23:00')::timestamptz, (:'wk'::date + time '07:00')::timestamptz),       -- 480 min
  (:'uc', :'wk'::date + 2, (:'wk'::date + 2 + time '00:00')::timestamptz, (:'wk'::date + 2 + time '06:30')::timestamptz), -- 390 min
  (:'uc', :'wk'::date - 1, (:'wk'::date - 1 + time '00:00')::timestamptz, (:'wk'::date - 1 + time '05:00')::timestamptz); -- week before
insert into public.body_metrics (user_id, measured_on, weight_kg, waist_cm) values
  (:'uc', :'wk'::date - 3, 80.0, null), (:'uc', :'wk'::date + 1, 79.4, null), (:'uc', :'wk'::date + 5, 79.0, null), (:'uc', :'wk'::date + 6, null, 85);
update public.user_settings set daily_water_ml = 2000 where user_id = :'uc';
insert into public.water_entries (user_id, drunk_on, amount_ml) values
  (:'uc', :'wk'::date, 1500), (:'uc', :'wk'::date, 600), (:'uc', :'wk'::date + 1, 1999), (:'uc', :'wk'::date + 2, 2000), (:'uc', :'wk'::date - 1, 3000);

-- coach replies must carry the server signature (20261108000000); test secret and signer
insert into private.push_config (id, function_url, secret) values (true, 'http://127.0.0.1:9/push', 'coach-test-secret')
  on conflict (id) do update set secret = excluded.secret;
create function pg_temp.coach_sig(c uuid, t text) returns text language sql as $f$
  select encode(extensions.hmac(c::text || ':' || t, encode(extensions.hmac('coach-reply-v1', 'coach-test-secret', 'sha256'), 'hex'), 'sha256'), 'hex')
$f$;
grant execute on function pg_temp.coach_sig(uuid, text) to authenticated;
-- replies with a payload (20261190000000): v2 key over "<id>:<content bytes>:<content>:<payload text>"
create function pg_temp.coach_sig2(c uuid, t text, p text) returns text language sql as $f$
  select encode(extensions.hmac(c::text || ':' || octet_length(t)::text || ':' || t || ':' || p, encode(extensions.hmac('coach-reply-v2', 'coach-test-secret', 'sha256'), 'hex'), 'sha256'), 'hex')
$f$;
grant execute on function pg_temp.coach_sig2(uuid, text, text) to authenticated;
set local role authenticated;
set local request.jwt.claims = :'jwt_c';
select public.record_consent('health_data', 'test');
select is(
  public.get_week_summary(:'wk'::date + 3),
  jsonb_build_object('week_start', :'wk'::date, 'workouts', 3, 'sets', 15, 'volume_kg', 1500.5, 'cardio_minutes', 31,
                     'habit_rate', 0.429, 'todos_done', 2, 'avg_sleep_minutes', 435, 'weight_change_kg', -1.0, 'water_goal_days', 2),
  'week summary: Monday-start Istanbul week totals on a small fixture (any day of the week selects it)'
);
set local request.jwt.claims = :'jwt_b';
select ok(
  (select (s ->> 'workouts')::int = 0 and (s ->> 'sets')::int = 0 and (s ->> 'todos_done')::int = 0
          and s -> 'habit_rate' = 'null'::jsonb and s -> 'avg_sleep_minutes' = 'null'::jsonb
   from (select public.get_week_summary(:'wk'::date) s) x),
  'week summary IDOR: another user gets none of carol''s numbers'
);
set local request.jwt.claims = :'jwt_c';
select public.withdraw_health_consent('test');
select is(
  public.get_week_summary(:'wk'::date) - 'week_start',
  jsonb_build_object('workouts', 3, 'sets', 15, 'volume_kg', 1500.5, 'cardio_minutes', 31, 'habit_rate', 0.429, 'todos_done', 2,
                     'avg_sleep_minutes', null, 'weight_change_kg', null, 'water_goal_days', null),
  'week summary: health parts are null without health consent'
);
select is((select count(*)::int from public.user_badges where badge_code = 'photos_10'), 1, 'badges: erasing the photos (consent withdrawal) keeps photos_10');

-- AI coach ------------------------------------------------------------------------------------
insert into public.ai_conversations (id, user_id, title) values (:'conv1', :'uc', 'Haftam');
insert into public.ai_messages (conversation_id, user_id, role, content) values (:'conv1', :'uc', 'user', 'Bu hafta nasil gittim?');
select is((select count(*)::int from public.ai_messages), 1, 'coach: the owner writes a user message');
select throws_ok(
  $$ insert into public.ai_messages (conversation_id, user_id, role, content) values ('00000000-0000-0000-0000-000000000541', '00000000-0000-0000-0000-00000000000c', 'assistant', 'fake') $$,
  '42501', null, 'coach: clients cannot insert assistant messages'
);
select throws_ok(
  $$ insert into public.ai_messages (conversation_id, user_id, role, content) values ('00000000-0000-0000-0000-000000000541', '00000000-0000-0000-0000-00000000000c', 'user', repeat('x', 4001)) $$,
  '23514', null, 'coach: messages are at most 4000 characters'
);
select throws_like($$ select public.ai_add_assistant_message('00000000-0000-0000-0000-000000000541', 'Harika', 'deadbeef') $$, '%BAD_SIGNATURE%', 'coach: a reply without the server signature is refused');
select throws_like($$ select public.ai_add_assistant_message('00000000-0000-0000-0000-000000000541', 'Harika', pg_temp.coach_sig('00000000-0000-0000-0000-000000000541', 'Harika')) $$, '%NO_RESERVATION%', 'coach: no assistant reply without a reserved AI request');
reset role;
insert into public.ai_usage (user_id, day, request_count) values (:'uc', current_date, 1)
  on conflict (user_id, day) do update set request_count = 1;
set local role authenticated;
set local request.jwt.claims = :'jwt_c';
select ok(public.ai_add_assistant_message(:'conv1', 'Harika gidiyorsun', pg_temp.coach_sig(:'conv1', 'Harika gidiyorsun')) is not null, 'coach: one assistant reply per reserved request is stored');
select throws_like($$ select public.ai_add_assistant_message('00000000-0000-0000-0000-000000000541', 'ikinci', pg_temp.coach_sig('00000000-0000-0000-0000-000000000541', 'ikinci')) $$, '%NO_RESERVATION%', 'coach: a second reply needs a second reservation');
select throws_ok($$ select public.ai_add_assistant_message('00000000-0000-0000-0000-000000000541', repeat('x', 4001), 'x') $$, '22023', 'BAD_CONTENT', 'coach: assistant replies are length-checked');

-- program payload (20261190000000): signed together with the content, stored as jsonb
reset role;
select ok(
  to_regprocedure('public.ai_add_assistant_message(uuid, text, text)') is null
  and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'ai_add_assistant_message') = 1
  and has_function_privilege('authenticated', 'public.ai_add_assistant_message(uuid, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.ai_add_assistant_message(uuid, text, text, text)', 'execute'),
  'coach payload: one ai_add_assistant_message (uuid, text, text, text), no ambiguous overload; authenticated only'
);
update public.ai_usage set request_count = 2 where user_id = :'uc' and day = current_date;
set local role authenticated;
set local request.jwt.claims = :'jwt_c';
\set cpay '{"program":{"name":"Tüm vücut","notes":null,"days":[{"name":"Gün 1","exercises":[{"exercise_id":"e1","name_en":"Goblet Squat","name_tr":null,"sets":3,"reps":10,"rest_sec":90}]}]},"unmatched":["Cable Crossover"]}'
select throws_like(
  format('select public.ai_add_assistant_message(%L, %L, %L, %L)', :'conv1', 'Program özeti', pg_temp.coach_sig2(:'conv1', 'Program özeti', :'cpay'), replace(:'cpay', '"sets":3', '"sets":30')),
  '%BAD_SIGNATURE%', 'coach payload: a tampered payload is refused');
select throws_like(
  format('select public.ai_add_assistant_message(%L, %L, %L, %L)', :'conv1', 'Program özeti!', pg_temp.coach_sig2(:'conv1', 'Program özeti', :'cpay'), :'cpay'),
  '%BAD_SIGNATURE%', 'coach payload: tampered content with a payload is refused');
select throws_like(
  format('select public.ai_add_assistant_message(%L, %L, %L, %L)', :'conv1', 'Program özeti', pg_temp.coach_sig(:'conv1', 'Program özeti'), :'cpay'),
  '%BAD_SIGNATURE%', 'coach payload: a content-only (v1) signature does not cover an added payload');
select throws_like(
  format('select public.ai_add_assistant_message(%L, %L, %L)', :'conv1', 'Program özeti', pg_temp.coach_sig2(:'conv1', 'Program özeti', :'cpay')),
  '%BAD_SIGNATURE%', 'coach payload: a payload signature cannot store the content without its payload');
select throws_ok(
  format('select public.ai_add_assistant_message(%L, %L, %L, %L)', :'conv1', 'Big', pg_temp.coach_sig2(:'conv1', 'Big', '{"x":"' || repeat('x', 32768) || '"}'), '{"x":"' || repeat('x', 32768) || '"}'),
  '22023', 'BAD_PAYLOAD', 'coach payload: payloads over 32 KB are refused');
select throws_ok(
  format('select public.ai_add_assistant_message(%L, %L, %L, %L)', :'conv1', 'Liste', pg_temp.coach_sig2(:'conv1', 'Liste', '[1,2]'), '[1,2]'),
  '22023', 'BAD_PAYLOAD', 'coach payload: the payload must be a JSON object');
select throws_ok(
  format('select public.ai_add_assistant_message(%L, %L, %L, %L)', :'conv1', 'Bozuk', pg_temp.coach_sig2(:'conv1', 'Bozuk', '{nope'), '{nope'),
  '22023', 'BAD_PAYLOAD', 'coach payload: malformed JSON is refused even when signed');
select ok(public.ai_add_assistant_message(:'conv1', 'Program özeti', pg_temp.coach_sig2(:'conv1', 'Program özeti', :'cpay'), :'cpay') is not null,
  'coach payload: a reply with a correctly signed payload is stored');
select is((select payload from public.ai_messages where conversation_id = :'conv1' and content = 'Program özeti'), :'cpay'::jsonb,
  'coach payload: the owner reads the stored program back');
select is((select count(*)::int from public.ai_messages where conversation_id = :'conv1' and payload is null and role = 'assistant'), 1,
  'coach payload: the earlier reply stored without a payload (old-style call) keeps payload null');
select throws_ok(
  format('insert into public.ai_messages (conversation_id, user_id, role, content, payload) values (%L, %L, %L, %L, %L)', :'conv1', :'uc', 'user', 'kart', :'cpay'),
  '23514', null, 'coach payload: clients cannot attach a payload to their own messages');
select is((select string_agg(role, ',' order by role) from public.ai_messages where conversation_id = :'conv1'), 'assistant,assistant,user', 'coach: the conversation holds the question and the replies');
update public.ai_messages set content = 'edited';
select is((select count(*)::int from public.ai_messages where content = 'edited'), 0, 'coach: messages are immutable');
update public.ai_conversations set user_id = :'ub' where id = :'conv1';
select is((select user_id from public.ai_conversations where id = :'conv1'), :'uc'::uuid, 'coach: a conversation cannot be handed to another user');

set local request.jwt.claims = :'jwt_b';
select is((select count(*)::int from public.ai_conversations) + (select count(*)::int from public.ai_messages), 0, 'coach IDOR: bob reads none of carol''s conversations or messages');
select is((select count(*)::int from public.ai_messages where payload is not null), 0, 'coach payload IDOR: bob reads no stored program payload');
select throws_ok(
  format('select public.ai_add_assistant_message(%L, %L, %L, %L)', :'conv1', 'x', pg_temp.coach_sig2(:'conv1', 'x', '{}'), '{}'),
  '42501', 'FORBIDDEN', 'coach payload IDOR: bob cannot add a reply with a payload to carol''s conversation');
select throws_ok(
  $$ insert into public.ai_messages (conversation_id, user_id, role, content) values ('00000000-0000-0000-0000-000000000541', '00000000-0000-0000-0000-00000000000b', 'user', 'hi') $$,
  '42501', 'FORBIDDEN', 'coach IDOR: bob cannot post into carol''s conversation'
);
select throws_ok($$ select public.ai_add_assistant_message('00000000-0000-0000-0000-000000000541', 'x', pg_temp.coach_sig('00000000-0000-0000-0000-000000000541', 'x')) $$, '42501', 'FORBIDDEN', 'coach IDOR: bob cannot add a reply to carol''s conversation');
delete from public.ai_messages where conversation_id = :'conv1';
delete from public.ai_conversations where id = :'conv1';
select is(
  (select count(*)::int from public.workout_sessions where ended_at is not null and started_at >= (current_date - 27)::timestamptz),
  (public.get_coach_context() #>> '{workouts,sessions}')::int,
  'coach context IDOR: bob''s context counts only his own sessions'
);
set local request.jwt.claims = :'jwt_c';
select is((select count(*)::int from public.ai_messages where conversation_id = :'conv1'), 3, 'coach IDOR: bob''s deletes left carol''s conversation untouched');

select ok(
  (select (c #>> '{workouts,sessions}')::int = 2 and (c #>> '{workouts,sets}')::int = 4
          and c #>> '{body_parts,0,body_part}' = 'chest' and (c #>> '{body_parts,0,sets}')::int = 4
          and (c #>> '{habits,due}')::int > 0 and (c ->> 'todos_done')::int = 50
          and c -> 'weight' = 'null'::jsonb and c -> 'sleep' = 'null'::jsonb and c -> 'nutrition' = 'null'::jsonb
          and (c ->> 'health_consent')::boolean = false
   from (select public.get_coach_context() c) x),
  'coach context: 28-day aggregates (sessions, sets by body part, habits, to-dos); no health parts without consent'
);
select ok(
  (select position('@' in c::text) = 0 and position('arol' in c::text) = 0 and position('avatar' in c::text) = 0 and position('.bin' in c::text) = 0
   from (select public.get_coach_context() c) x),
  'coach context: no e-mail, name, username, avatar or photo reference'
);
select public.record_consent('health_data', 'test');
insert into public.body_metrics (user_id, measured_on, weight_kg) values (:'uc', current_date, 78.5);
select is(public.get_coach_context() #>> '{weight,latest_kg}', '78.5', 'coach context: weight is included with health consent');

delete from public.ai_conversations where id = :'conv1';
select is((select count(*)::int from public.ai_messages), 0, 'coach: deleting a conversation deletes its messages');
insert into public.ai_conversations (user_id) select :'uc' from generate_series(1, 100);
select throws_like($$ insert into public.ai_conversations (user_id) values ('00000000-0000-0000-0000-00000000000c') $$, '%LIMIT_REACHED%', 'coach: at most 100 conversations per user');
delete from public.ai_conversations;
insert into public.ai_conversations (id, user_id) values (:'conv2', :'uc');
insert into public.ai_messages (conversation_id, user_id, role, content) select :'conv2', :'uc', 'user', 'soru ' || g from generate_series(1, 100) g;
select throws_like(
  $$ insert into public.ai_messages (conversation_id, user_id, role, content) values ('00000000-0000-0000-0000-000000000542', '00000000-0000-0000-0000-00000000000c', 'user', 'one more') $$,
  '%LIMIT_REACHED%', 'coach: at most 100 user messages per day'
);
reset role;
set local request.jwt.claims = '';

-- pre-publication privacy audit ---------------------------------------------------------------
reset role;
insert into storage.objects (bucket_id, name) values
  ('avatars', '00000000-0000-0000-0000-00000000000a/a.jpg'),
  ('avatars', '00000000-0000-0000-0000-00000000000b/b.jpg');
select is(
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'),
  0, 'privacy: the anon role has no privilege on any table'
);
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('authenticated', c.oid, 'TRUNCATE')),
  0, 'privacy: no table can be truncated by signed-in users'
);
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0, 'privacy: every public table has row level security on'
);
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*)::int from storage.objects where bucket_id = 'avatars'), 0, 'privacy: anonymous visitors cannot list avatars');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
select is((select array_agg(name) from storage.objects where bucket_id = 'avatars'), array['00000000-0000-0000-0000-00000000000b/b.jpg'], 'privacy: users list only their own avatar folder');
select is((select count(*)::int from public.app_config), 0, 'privacy: non-admins cannot read app_config (admin e-mail)');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select ok((select count(*) from public.app_config) > 0, 'privacy: the admin still reads app_config');
select is((select count(*)::int from storage.objects where bucket_id = 'avatars'), 2, 'privacy: the admin can list avatars (rejected-user cleanup)');
select throws_like($$ select public.delete_my_account() $$, '%LAST_ADMIN%', 'account: the last admin cannot delete their account');
select throws_ok($$ insert into public.user_consents (user_id, kind, version, granted) values ('00000000-0000-0000-0000-00000000000a', 'health_data', 'x', true) $$, '42501', null, 'consent: the log is written only by the consent functions');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
select public.record_consent('privacy_notice', 'test');
select is((select count(*)::int from public.user_consents where kind = 'privacy_notice'), 1, 'consent: the privacy-notice acknowledgement is logged');
insert into public.water_entries (user_id, drunk_on, amount_ml) values (:'ub', current_date, 250);
select public.withdraw_health_consent('test');
select ok(not public.has_health_consent(), 'consent: withdrawal is recorded');
reset role;
select is((select count(*)::int from public.water_entries where user_id = :'ub') + (select count(*)::int from public.body_metrics where user_id = :'ub')
          + (select count(*)::int from public.photo_vault where user_id = :'ub'), 0, 'consent: withdrawal erases the health data');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select public.withdraw_ai_consent('test');
select throws_like($$ select public.ai_reserve() $$, '%AI_CONSENT_REQUIRED%', 'ai: withdrawing the AI consent stops further requests');
select throws_ok($$ select public.ai_consent_of('00000000-0000-0000-0000-00000000000a') $$, '42501', null, 'ai: the consent helper is internal');
select public.record_consent('ai_processing', '2026-10-30');
select throws_like($$ select public.ai_reserve() $$, '%AI_CONSENT_REQUIRED%', 'ai: a consent to an older AI text does not count');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
select lives_ok($$ update public.profile_private set birth_year = extract(year from current_date)::int - 10 where user_id = '00000000-0000-0000-0000-00000000000b' $$, 'age: users under 18 may use the app');
select throws_like($$ select public.record_consent('ai_processing', 'test') $$, '%UNDERAGE%', 'age: under 18 cannot consent to AI');
select throws_like($$ select public.ai_reserve() $$, '%AI_UNDERAGE%', 'age: AI requests are refused under 18 even after an earlier consent');
reset role;

-- =============================================================================
-- Security hardening (20261120000000)
-- =============================================================================
reset role;
set local request.jwt.claims = '';
update public.app_config set value = '"open"'::jsonb where key = 'access_mode';
update public.app_config set value = 'true'::jsonb where key = 'require_approval';
\set ue '00000000-0000-0000-0000-00000000000e'
\set jwt_e '{"sub":"00000000-0000-0000-0000-00000000000e","email":"eve@example.com","role":"authenticated"}'
insert into auth.users (id, email, instance_id, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  (:'ue', 'eve@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}', '{}', now(), now());

-- 1. a signed-in user without a profile has no access, only the onboarding writes
set local role authenticated;
set local request.jwt.claims = :'jwt_e';
select ok(not public.can_access() and public.can_onboard(), 'hardening: no profile -> can_access false, can_onboard true');
select is((select count(*)::int from public.profiles), 0, 'hardening: no profile -> other profiles are invisible');
select is((select count(*)::int from public.get_leaderboard('week', 50)), 0, 'hardening: no profile -> no leaderboard');
update public.user_settings set locale = 'en';
select is((select count(*)::int from public.user_settings), 0, 'hardening: no profile -> user tables are closed');
select throws_ok($$ select public.ai_reserve() $$, '42501', 'FORBIDDEN', 'hardening: no profile -> no AI quota');
select throws_ok($$ select public.record_consent('ai_processing', 'test') $$, '42501', 'FORBIDDEN', 'hardening: no profile -> only the privacy notice can be acknowledged');
select lives_ok($$ select public.record_consent('privacy_notice', 'v1') $$, 'hardening: onboarding acknowledges the privacy notice');
select public.record_consent('privacy_notice', 'v1');
reset role;
select is((select count(*)::int from public.user_consents where user_id = :'ue'), 1, 'consent: an unchanged acknowledgement is not logged twice');
set local role authenticated;
select lives_ok($$ insert into public.profile_private (user_id, height_cm) values ('00000000-0000-0000-0000-00000000000e', 170)
                   on conflict (user_id) do update set height_cm = excluded.height_cm $$, 'hardening: onboarding upserts profile_private');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-00000000000e/avatar.jpg') $$, 'hardening: onboarding uploads the avatar');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-00000000000e/big.png') $$, '42501', null, 'storage: avatar names are only <uid>/avatar.(jpg|webp)');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-00000000000e/x/avatar.jpg') $$, '42501', null, 'storage: no nested avatar paths');
select ok(public.is_username_available('eve_1') and not public.is_username_available('bob') and not public.is_username_available('x'),
  'hardening: is_username_available works during onboarding (taken / malformed -> false)');
select lives_ok($$ insert into public.error_reports (route) values ('/onboarding') $$, 'reports: a user without a profile can report an onboarding error');
insert into public.profiles (user_id, username, display_name, avatar_path, onboarding_completed_at)
values (:'ue', 'eve_1', 'Eve', '00000000-0000-0000-0000-00000000000e/avatar.jpg', now());
select is((select status from public.profiles where user_id = :'ue'), 'pending', 'hardening: eve onboarded and is pending');
select is((select count(*)::int from public.get_public_profile('00000000-0000-0000-0000-00000000000a')), 0, 'hardening: a pending user gets no public profiles');
select lives_ok($$ select public.record_consent('privacy_notice', 'v2') $$, 'hardening: a pending user may acknowledge a new notice');
set local request.jwt.claims = :'jwt_a';
select public.admin_set_registration_status(:'ue', 'rejected');
set local request.jwt.claims = :'jwt_e';
select is((select status from public.profiles), 'rejected', 'hardening: a rejected user still reads her own profile');
select ok(not public.can_onboard() and not public.can_access(), 'hardening: a rejected user can neither onboard nor access');
select throws_ok($$ select public.record_consent('privacy_notice', 'v3') $$, '42501', 'FORBIDDEN', 'hardening: a rejected user cannot record consents');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-00000000000e/avatar.webp') $$, '42501', null, 'hardening: a rejected user cannot upload avatars');
select throws_ok($$ select public.is_username_available('abc') $$, '42501', 'FORBIDDEN', 'hardening: is_username_available needs onboarding or access');

-- 2. profiles: owner/admin only; public fields via get_public_profile
set local request.jwt.claims = :'jwt_a';
select is((select count(*)::int from public.profiles where user_id = :'ue'), 1, 'profiles: the admin reads every profile');
set local request.jwt.claims = :'jwt_b';
select is(
  (select array_agg(k order by k) from public.get_public_profile('00000000-0000-0000-0000-00000000000c') g, jsonb_object_keys(to_jsonb(g)) k),
  array['avatar_path', 'created_at', 'current_streak', 'display_name', 'level', 'total_points', 'username'],
  'get_public_profile returns only the public columns'
);
select is((select count(*)::int from public.get_public_profile('00000000-0000-0000-0000-00000000000e')), 0, 'get_public_profile: nothing for a rejected user');
select is((select count(*)::int from public.get_public_profile('00000000-0000-0000-0000-00000000000d')), 0, 'get_public_profile: nothing for a pending user');
reset role;
update public.profiles set show_on_leaderboard = false where user_id = :'ub';
set local role authenticated;
select is((select count(*)::int from public.get_public_profile('00000000-0000-0000-0000-00000000000b')), 1, 'get_public_profile: a hidden user sees herself');
set local request.jwt.claims = :'jwt_a';
select is((select count(*)::int from public.get_public_profile('00000000-0000-0000-0000-00000000000b')), 0, 'get_public_profile: nothing for a user hidden from the leaderboard');

-- 12. leaderboard: hidden users see their own row; all-time = total_points
select is((select count(*)::int from public.get_leaderboard('all', 50) where username = 'bob'), 0, 'leaderboard: a hidden user is not listed for others');
set local request.jwt.claims = :'jwt_b';
select is((select count(*)::int from public.get_leaderboard('all', 50) where is_me), 1, 'leaderboard: a hidden user still sees her own rank row');
select is((select points from public.get_leaderboard('all', 50) where is_me), (select total_points::bigint from public.profiles where user_id = :'ub'),
  'leaderboard: all-time points come from profiles.total_points');
reset role;
update public.profiles set show_on_leaderboard = true where user_id = :'ub';

-- 6. profiles guard keeps created_at and username_changed_at
set local role authenticated;
set local request.jwt.claims = :'jwt_c';
create temp table t_prof as select created_at, username_changed_at from public.profiles where user_id = :'uc';
update public.profiles set created_at = now() - interval '5 years', username_changed_at = now() - interval '1 year' where user_id = :'uc';
select ok((select p.created_at = t.created_at and p.username_changed_at is not distinct from t.username_changed_at
             from public.profiles p, t_prof t where p.user_id = :'uc'), 'profiles guard: created_at and username_changed_at are not client-editable');
update public.profiles set username = 'carol_2' where user_id = :'uc';
select ok((select username_changed_at > now() - interval '1 minute' from public.profiles where user_id = :'uc'), 'profiles guard: a real rename stamps username_changed_at');
select throws_like($$ update public.profiles set username = 'carol_3', username_changed_at = null where user_id = '00000000-0000-0000-0000-00000000000c' $$,
  '%USERNAME_COOLDOWN%', 'profiles guard: the 30-day rename rule cannot be bypassed');

-- 7. blocked users cannot file error reports
set local request.jwt.claims = :'jwt_a';
select public.admin_set_blocked(:'uc', true);
set local request.jwt.claims = :'jwt_c';
select throws_ok($$ insert into public.error_reports (route) values ('/x') $$, '42501', null, 'reports: a blocked user cannot file reports');
select ok(not public.can_onboard(), 'hardening: a blocked user cannot onboard');
set local request.jwt.claims = :'jwt_a';
select public.admin_set_blocked(:'uc', false);

-- 4. record_consent daily cap
reset role;
insert into public.user_consents (user_id, kind, version, granted)
  select :'ua', 'adult', 'cap' || g, true
  from generate_series(1, greatest(0, 20 - (select count(*)::int from public.user_consents where user_id = :'ua' and created_at >= current_date::timestamptz))) g;
set local role authenticated;
set local request.jwt.claims = :'jwt_a';
select throws_like($$ select public.record_consent('health_data', 'cap-test') $$, '%RATE_LIMITED%', 'consent: at most 20 consent rows per user per day');

-- 5. register_push: push-service hosts only
select throws_ok($$ select public.register_push('https://evil.example.com/x', 'abc', 'def', null) $$, '22023', 'BAD_ENDPOINT', 'push: unknown push hosts are rejected');
select throws_ok($$ select public.register_push('https://fcm.googleapis.com.evil.io/x', 'abc', 'def', null) $$, '22023', 'BAD_ENDPOINT', 'push: look-alike hosts are rejected');
select throws_ok($$ select public.register_push('https://user@fcm.googleapis.com/x', 'abc', 'def', null) $$, '22023', 'BAD_ENDPOINT', 'push: userinfo tricks are rejected');
select lives_ok($$ select public.register_push('https://web.push.apple.com/abc', 'abc', 'def', null) $$, 'push: Apple push hosts are accepted');
select lives_ok($$ select public.register_push('https://updates.push.services.mozilla.com/wpush/v2/x', 'abc', 'def', null) $$, 'push: Mozilla is accepted');
select lives_ok($$ select public.register_push('https://wns2-par02p.notify.windows.com/w/?token=x', 'abc', 'def', null) $$, 'push: Windows is accepted');

-- 3. progress-photos: 2 MB files, 150 MB per user
reset role;
select is((select file_size_limit from storage.buckets where id = 'progress-photos'), 2097152::bigint, 'storage: progress-photos files are at most 2 MB');
insert into public.user_consents (user_id, kind, version, granted) values (:'ub', 'health_data', 'test', true);
update public.profile_private set birth_year = null where user_id = :'ub';
set local role authenticated;
set local request.jwt.claims = :'jwt_b';
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id) values ('progress-photos', '00000000-0000-0000-0000-00000000000b/' || gen_random_uuid() || '.img.bin', '00000000-0000-0000-0000-00000000000b') $$,
  'storage: a photo upload under the byte cap is accepted');
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('progress-photos', :'ub' || '/' || gen_random_uuid() || '.img.bin', :'ub', '{"size": 157286400}');
set local role authenticated;
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id) values ('progress-photos', '00000000-0000-0000-0000-00000000000b/' || gen_random_uuid() || '.img.bin', '00000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'storage: uploads stop at 150 MB per user');

-- 8. AI quota
reset role;
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'user_settings' and column_name = 'ai_daily_limit'), '10', 'ai: the default per-user limit is 10');
select is((select ai_daily_limit from public.user_settings where user_id = :'ue'), 10, 'ai: new users get 10 requests a day');
select ok(pg_get_functiondef('public.ai_reserve()'::regprocedure) like '%pg_advisory_xact_lock(hashtext(''ai_reserve''))%', 'ai: ai_reserve serializes app-wide');
update public.app_config set value = '{"m1": {"rpd": 100, "rpm": 2, "tpm": 0}}'::jsonb where key = 'ai_model_limits';
update public.app_config set value = '["m1"]'::jsonb where key = 'ai_model_order';
update public.app_config set value = '450'::jsonb where key = 'ai_global_daily_limit';
delete from private.ai_reservations;
select is(public.ai_decide(:'ue') ->> 'reason', 'ok', 'ai: available while the minute budget is free');
insert into private.ai_reservations default values;
insert into private.ai_reservations default values;
select is(public.ai_decide(:'ue') ->> 'reason', 'google_minute', 'ai: the per-minute gate counts reservations, not only logged calls');
delete from private.ai_reservations;
update public.app_config set value = '1'::jsonb where key = 'ai_global_daily_limit';
insert into public.ai_usage (user_id, day, request_count) values (:'ua', current_date, 1)
  on conflict (user_id, day) do update set request_count = greatest(public.ai_usage.request_count, 1);
select is(public.ai_decide(:'ue') ->> 'reason', 'app_daily', 'ai: the app-wide budget counts reservations');
select ok(not has_function_privilege('authenticated', 'public.ai_decide(uuid)', 'execute'), 'ai: ai_decide is internal');

-- 9. retention
select is((select count(*)::int from cron.job where jobname = 'nightly-retention' and command = 'select private.run_retention()'), 1, 'retention: one nightly job');
insert into public.error_reports (user_id, route) values (:'ua', '/old-resolved'), (:'ua', '/old-open');
alter table public.error_reports disable trigger error_reports_guard;
update public.error_reports set created_at = now() - interval '100 days' where route in ('/old-resolved', '/old-open');
update public.error_reports set status = 'resolved', resolved_at = now() - interval '100 days' where route = '/old-resolved';
alter table public.error_reports enable trigger error_reports_guard;
insert into public.ai_usage_log (user_id, action, provider, model, created_at) values (:'ua', 'coach_chat', 'gemini', 'old', now() - interval '200 days');
select private.run_retention();
select ok(not exists (select 1 from public.error_reports where route = '/old-resolved')
          and exists (select 1 from public.error_reports where route = '/old-open')
          and not exists (select 1 from public.ai_usage_log where model = 'old'),
  'retention: removes old resolved reports and AI logs, keeps open reports');
select ok(not has_function_privilege('authenticated', 'private.run_retention()', 'execute'), 'retention: the job function is internal');

-- 10. monitoring
insert into private.push_monthly (month, sent) values (date_trunc('month', now())::date, 7)
  on conflict (month) do update set sent = 7;
set local role authenticated;
set local request.jwt.claims = :'jwt_a';
select is((public.admin_usage_summary() ->> 'push_month')::int, 7, 'monitoring: push_month reads the monthly counter');
reset role;
select ok(not has_function_privilege('authenticated', 'public.ops_health()', 'execute')
          and not has_function_privilege('anon', 'public.ops_health()', 'execute')
          and has_function_privilege('service_role', 'public.ops_health()', 'execute'), 'monitoring: ops_health is service_role only');
select is((select array_agg(k order by k) from jsonb_object_keys(public.ops_health()) k),
  array['db_bytes', 'failed_cron_24h', 'http_errors_24h', 'open_error_reports', 'storage_bytes'], 'monitoring: ops_health keys');
select ok((select bool_and(jsonb_typeof(v) = 'number') from jsonb_each(public.ops_health()) e(k, v)), 'monitoring: ops_health values are numeric');

-- 11. policies evaluate auth.uid() / helpers once (InitPlan)
select is(
  (select count(*)::int from pg_policies
    where (schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects'))
      and (coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ '(?<!SELECT )auth\.uid\(\)'
        or coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ '(?<!SELECT )(?<![.\w])(can_access|is_admin|can_onboard)\(\)')),
  0, 'rls perf: every policy wraps auth.uid() and the access helpers in a scalar subquery');
create function pg_temp.explain_lines(q text) returns setof text language plpgsql as $f$
begin return query execute 'explain ' || q; end $f$;
set local role authenticated;
set local request.jwt.claims = :'jwt_a';
select ok((select bool_or(l ~ 'InitPlan') from pg_temp.explain_lines('select * from public.session_sets') l)
          and not (select bool_or(l ~ 'SubPlan') from pg_temp.explain_lines('select * from public.session_sets') l),
  'rls perf: session_sets evaluates the access check as an InitPlan');

-- 12. invite list compares e-mails case-insensitively
reset role;
set local request.jwt.claims = '';
update public.app_config set value = '"invite"'::jsonb where key = 'access_mode';
insert into public.allowed_emails (email) values ('Frank@Example.com');
select lives_ok($$ insert into auth.users (id, email, instance_id, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-00000000000f', 'FRANK@example.COM', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}', '{}', now(), now()) $$,
  'invite: e-mails match case-insensitively');
select throws_like($$ insert into auth.users (id, email, instance_id, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000010', 'mallory@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}', '{}', now(), now()) $$,
  '%ACCESS_DENIED%', 'invite: others are still refused');
update public.app_config set value = '"open"'::jsonb where key = 'access_mode';

-- =============================================================================
-- Social (20261140000000)
-- =============================================================================
reset role;
set local request.jwt.claims = '';
update public.app_config set value = 'false'::jsonb where key = 'require_approval';
\set s1 '00000000-0000-0000-0000-000000000101'
\set s2 '00000000-0000-0000-0000-000000000102'
\set s3 '00000000-0000-0000-0000-000000000103'
\set s4 '00000000-0000-0000-0000-000000000104'
\set s5 '00000000-0000-0000-0000-000000000105'
\set s6 '00000000-0000-0000-0000-000000000106'
\set s7 '00000000-0000-0000-0000-000000000107'
\set s8 '00000000-0000-0000-0000-000000000108'
\set s9 '00000000-0000-0000-0000-000000000109'
\set s10 '00000000-0000-0000-0000-00000000010a'
\set s11 '00000000-0000-0000-0000-00000000010b'
\set j1 '{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated"}'
\set j2 '{"sub":"00000000-0000-0000-0000-000000000102","role":"authenticated"}'
\set j3 '{"sub":"00000000-0000-0000-0000-000000000103","role":"authenticated"}'
\set j4 '{"sub":"00000000-0000-0000-0000-000000000104","role":"authenticated"}'
\set j5 '{"sub":"00000000-0000-0000-0000-000000000105","role":"authenticated"}'
\set j6 '{"sub":"00000000-0000-0000-0000-000000000106","role":"authenticated"}'
\set j7 '{"sub":"00000000-0000-0000-0000-000000000107","role":"authenticated"}'
\set j8 '{"sub":"00000000-0000-0000-0000-000000000108","role":"authenticated"}'
\set j9 '{"sub":"00000000-0000-0000-0000-000000000109","role":"authenticated"}'
\set j10 '{"sub":"00000000-0000-0000-0000-00000000010a","role":"authenticated"}'
\set j11 '{"sub":"00000000-0000-0000-0000-00000000010b","role":"authenticated"}'
-- sam (public), pia (private), sid stranger, pen pending, fay follower, fred friend, bart blocked, gus group member,
-- nora never enables social, kid is under 18, nobirth has no birth year
insert into auth.users (id, email, instance_id, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u.id::uuid, u.n || '@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}', '{}', now(), now()
  from (values (:'s1', 'sam'), (:'s2', 'pia'), (:'s3', 'sid'), (:'s4', 'pen'), (:'s5', 'fay'), (:'s6', 'fred'),
               (:'s7', 'bart'), (:'s8', 'gus'), (:'s9', 'nora'), (:'s10', 'kid'), (:'s11', 'nobirth')) u(id, n);
insert into public.profiles (user_id, username, display_name, avatar_path, onboarding_completed_at)
select u.id::uuid, u.n || '_s', initcap(u.n), u.id || '/avatar.jpg', now()
  from (values (:'s1', 'sam'), (:'s2', 'pia'), (:'s3', 'sid'), (:'s4', 'pen'), (:'s5', 'fay'), (:'s6', 'fred'),
               (:'s7', 'bart'), (:'s8', 'gus'), (:'s9', 'nora'), (:'s10', 'kid'), (:'s11', 'nobirth')) u(id, n);
insert into public.profile_private (user_id, birth_year)
select u.id::uuid, u.y from (values (:'s1', 1990), (:'s2', 1991), (:'s3', 1992), (:'s4', 1993), (:'s5', 1994), (:'s6', 1995),
  (:'s7', 1996), (:'s8', 1997), (:'s9', 1998), (:'s10', extract(year from current_date)::int - 15), (:'s11', null)) u(id, y);
update public.app_config set value = 'true'::jsonb where key = 'require_approval';

select ok((select not public and file_size_limit = 614400 and allowed_mime_types = array['image/jpeg', 'image/webp']
             from storage.buckets where id = 'social-media'), 'social: social-media bucket is private, 600 KB, JPEG/WebP');
select is((select value #>> '{}' from public.app_config where key = 'social_consent_version'), '2026-11-01', 'social: consent version in app_config');
select is((select social_push from public.user_settings where user_id = :'s1'), true, 'social: social_push defaults to on');
select ok((select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.social_profiles'::regclass, 'public.follows'::regclass,
  'public.blocks'::regclass, 'public.groups'::regclass, 'public.group_members'::regclass, 'public.posts'::regclass, 'public.post_media'::regclass,
  'public.post_likes'::regclass, 'public.reports'::regclass, 'public.social_notifications'::regclass)), 'social: every social table has RLS');
select ok(not has_function_privilege('authenticated', 'private.social_wipe(uuid, boolean, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.social_likes_after()', 'execute')
  and not has_function_privilege('authenticated', 'public.social_age_guard()', 'execute')
  and not has_function_privilege('authenticated', 'public.social_before_user_delete()', 'execute')
  and not has_function_privilege('authenticated', 'public.ops_claim_storage_garbage(integer)', 'execute')
  and not has_function_privilege('anon', 'public.ops_claim_storage_garbage(integer)', 'execute')
  and has_function_privilege('service_role', 'public.ops_claim_storage_garbage(integer)', 'execute')
  and not has_table_privilege('authenticated', 'private.storage_garbage', 'select'),
  'social: wipe/trigger helpers internal, ops_claim_storage_garbage service_role only');
select is((select count(*)::int from pg_proc where prosecdef and pronamespace in ('public'::regnamespace, 'private'::regnamespace)
            and not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')), 0,
  'every security-definer function pins search_path');

create function pg_temp.vis(l text[], ids uuid[]) returns text[] language sql as $f$
  select coalesce(array_agg(x.l order by x.l), '{}') from unnest(l, ids) x(l, id) where public.can_view_post(x.id)
$f$;
create function pg_temp.social_msgs() returns int language sql as $f$
  select count(*)::int from net.http_request_queue q
   cross join lateral jsonb_array_elements(convert_from(q.body, 'UTF8')::jsonb -> 'messages') m
   where m -> 'payload' ->> 'tag' = 'social'
$f$;

-- Enabling ------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'j10';
select throws_ok($$ select public.social_enable('2026-11-01') $$, 'P0001', 'SOCIAL_UNDERAGE', 'social: under 18 is refused');
set local request.jwt.claims = :'j11';
select throws_ok($$ select public.social_enable('2026-11-01') $$, 'P0001', 'SOCIAL_BIRTH_YEAR_REQUIRED', 'social: a missing birth year is refused');
set local request.jwt.claims = :'jwt_d';
select throws_ok($$ select public.social_enable('2026-11-01') $$, '42501', 'FORBIDDEN', 'social: a pending user cannot enable social');
set local request.jwt.claims = :'j1';
select throws_ok($$ select public.social_enable('2025-01-01') $$, '22023', 'SOCIAL_CONSENT_VERSION', 'social: an old consent version is refused');
select lives_ok($$ select public.social_enable('2026-11-01') $$, 'social: an adult enables social');
set local request.jwt.claims = :'j2'; select public.social_enable('2026-11-01');
set local request.jwt.claims = :'j3'; select public.social_enable('2026-11-01');
set local request.jwt.claims = :'j4'; select public.social_enable('2026-11-01');
set local request.jwt.claims = :'j5'; select public.social_enable('2026-11-01');
set local request.jwt.claims = :'j6'; select public.social_enable('2026-11-01');
set local request.jwt.claims = :'j7'; select public.social_enable('2026-11-01');
set local request.jwt.claims = :'j8'; select public.social_enable('2026-11-01');
set local request.jwt.claims = :'j9';
select throws_ok($$ select public.social_follow('00000000-0000-0000-0000-000000000101') $$, 'P0001', 'SOCIAL_DISABLED', 'social: a non-social user cannot follow');
reset role;
select is((select count(*)::int from public.user_consents where kind = 'social' and granted and user_id::text like '00000000-0000-0000-0000-0000000001%'), 8,
  'social: enabling records the social consent');
select is((select count(*)::int from public.social_profiles where enabled and is_private), 8, 'social: accounts start private');
set local role authenticated;
set local request.jwt.claims = :'j1';
select public.social_update_settings(false, null, 'Hello there');
set local request.jwt.claims = :'j6';
select public.social_update_settings(false);
select throws_ok($$ select public.social_update_settings(null, null, repeat('x', 161)) $$, '22023', 'BAD_BIO', 'social: bio is at most 160 characters');

-- Follows --------------------------------------------------------------------------------------
set local request.jwt.claims = :'j4';
select is(public.social_follow('00000000-0000-0000-0000-000000000102'), 'pending', 'follow: a private account gets a request');
set local request.jwt.claims = :'j5';
select is(public.social_follow('00000000-0000-0000-0000-000000000101'), 'accepted', 'follow: a public account is followed at once');
select public.social_follow(:'s2');
set local request.jwt.claims = :'j6';
select public.social_follow(:'s1'); select public.social_follow(:'s2');
set local request.jwt.claims = :'j7';
select public.social_follow(:'s1');
set local request.jwt.claims = :'j2';
select lives_ok($$ select public.social_respond_follow('00000000-0000-0000-0000-000000000105', true) $$, 'follow: the owner accepts a request');
select public.social_respond_follow(:'s6', true);
select is(public.social_follow('00000000-0000-0000-0000-000000000106'), 'accepted', 'follow: pia follows fred back (friends)');
select is((select count(*)::int from public.social_follow_requests()), 1, 'follow: one open request left (pen)');
set local request.jwt.claims = :'j1';
select public.social_follow(:'s6');
reset role;
select ok(exists (select 1 from public.social_notifications where user_id = :'s2' and kind = 'follow_request' and actor_id = :'s4')
      and exists (select 1 from public.social_notifications where user_id = :'s5' and kind = 'follow_accepted' and actor_id = :'s2')
      and (select count(*) from public.social_notifications where user_id = :'s1' and kind = 'follow') = 3,
  'notifications: follow, follow_request and follow_accepted are written by triggers');

-- Groups -------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'j1';
select public.group_create('Closed Crew', 'secret plans', 'closed') as gc \gset
select public.group_create('Open Gym', 'all welcome', 'open') as go \gset
set local request.jwt.claims = :'j2';
select is(public.group_join(:'gc'), 'pending', 'groups: joining a closed group is a request');
set local request.jwt.claims = :'j1';
select lives_ok(format('select public.group_respond(%L, true, %L)', :'gc', :'s2'), 'groups: the owner approves the request');
reset role;
select ok(exists (select 1 from public.social_notifications where user_id = :'s1' and kind = 'group_request' and actor_id = :'s2')
      and exists (select 1 from public.social_notifications where user_id = :'s2' and kind = 'group_accepted' and actor_id = :'s1')
      and (select status from public.group_members where group_id = :'gc' and user_id = :'s2') = 'active',
  'groups: request and approval notify both sides');
select invite_code as gccode from public.groups where id = :'gc' \gset
set local role authenticated;
set local request.jwt.claims = :'j8';
select is(public.group_join_by_code(lower(:'gccode')), :'gc'::uuid, 'groups: the invite code joins a closed group');
select is(public.group_join_by_code('AAAAAAAAAA'), null::uuid, 'groups: a wrong code joins nothing (null)');
set local request.jwt.claims = :'j3';
select is(public.group_join(:'go'), 'active', 'groups: an open group is joined at once');
set local request.jwt.claims = :'j7';
select public.group_join(:'go');
set local request.jwt.claims = :'j1';
select public.group_invite(:'go', :'s5');
reset role;
select ok(exists (select 1 from public.social_notifications where user_id = :'s5' and kind = 'group_invite' and group_id = :'go'),
  'groups: an invitation notifies the invitee');
set local role authenticated;
set local request.jwt.claims = :'j5';
select is((select status from public.social_my_groups() where group_id = :'go'), 'invited', 'groups: the invitee sees the invitation');
select lives_ok(format('select public.group_respond(%L, true)', :'go'), 'groups: the invitee accepts');
select is((select status from public.social_my_groups() where group_id = :'go'), 'active', 'groups: the invitation became a membership');
set local request.jwt.claims = :'j1';
select lives_ok(format('select public.group_set_role(%L, %L, %L)', :'gc', :'s2', 'admin'), 'groups: the owner promotes an admin');
set local request.jwt.claims = :'j2';
select lives_ok(format('select public.group_rotate_code(%L)', :'gc'), 'groups: an admin rotates the invite code');
select throws_ok(format('select public.group_remove_member(%L, %L)', :'gc', :'s1'), '42501', 'FORBIDDEN', 'groups: an admin cannot remove the owner');
set local request.jwt.claims = :'j8';
select throws_ok(format('select public.group_rotate_code(%L)', :'gc'), '42501', 'FORBIDDEN', 'groups: a member cannot rotate the code');
select throws_ok(format('select public.group_set_role(%L, %L, %L)', :'gc', :'s8', 'admin'), '42501', 'FORBIDDEN', 'groups: a member cannot change roles');
set local request.jwt.claims = :'j3';
select is((select row(description, member_count)::text from public.social_search_groups('closed cr')), '(,)',
  'groups: a closed group shows only its name to non-members');
select is((select count(*)::int from public.social_group_members(:'gc')), 0, 'groups: closed member lists are hidden from non-members');
select is((select count(*)::int from public.social_group_members(:'go')), 4, 'groups: open group members are listed');
reset role;
insert into public.groups (owner_id, name, visibility, invite_code)
select :'s4', 'Group ' || i, 'open', private.new_invite_code() from generate_series(1, 20) i;
set local role authenticated;
set local request.jwt.claims = :'j4';
select throws_ok($$ select public.group_create('One too many') $$, 'P0001', 'GROUP_LIMIT', 'groups: at most 20 owned groups');

-- Posts ----------------------------------------------------------------------------------------
set local request.jwt.claims = :'j1';
select public.social_create_post('text', 'p1 public', null, 'public') as p1pub \gset
select public.social_create_post('text', 'p1 followers', null, 'followers') as p1fol \gset
select public.social_create_post('text', 'p1 friends', null, 'friends') as p1fr \gset
select public.social_create_post('text', 'p1 group', null, 'group', :'gc') as p1grp \gset
set local request.jwt.claims = :'j2';
select public.social_create_post('text', 'p2 public', null, 'public') as p2pub \gset
select public.social_create_post('text', 'p2 followers', null, 'followers') as p2fol \gset
select public.social_create_post('text', 'p2 friends', null, 'friends') as p2fr \gset
select public.social_create_post('text', 'p2 group', null, 'group', :'gc') as p2grp \gset
set local request.jwt.claims = :'j7';
select public.social_like(:'p1pub');
set local request.jwt.claims = :'j1';
select lives_ok($$ select public.social_block('00000000-0000-0000-0000-000000000107') $$, 'block: sam blocks bart');
set local request.jwt.claims = :'j2';
select public.social_block(:'s7');
select is((select count(*)::int from public.social_blocked_users()), 1, 'block: the blocker lists blocked users');
reset role;
select ok(not exists (select 1 from public.follows where :'s7' in (follower_id, followee_id))
      and (select like_count from public.posts where id = :'p1pub') = 0
      and not exists (select 1 from public.social_notifications where actor_id = :'s7' and user_id = :'s1'),
  'block: follows both ways, the blocked user''s likes and notifications are removed');

-- Visibility matrix (labels fol, fr, grp, pub) -------------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'j1';
select is(pg_temp.vis(array['fol', 'fr', 'grp', 'pub'], array[:'p1fol', :'p1fr', :'p1grp', :'p1pub']::uuid[]), array['fol', 'fr', 'grp', 'pub'], 'matrix: the author sees all own posts');
set local request.jwt.claims = :'j3';
select is(pg_temp.vis(array['fol', 'fr', 'grp', 'pub'], array[:'p1fol', :'p1fr', :'p1grp', :'p1pub']::uuid[]), array['pub'], 'matrix: public author x stranger');
select is(pg_temp.vis(array['fol', 'fr', 'grp', 'pub'], array[:'p2fol', :'p2fr', :'p2grp', :'p2pub']::uuid[]), '{}'::text[], 'matrix: private author x stranger');
set local request.jwt.claims = :'j4';
select is(pg_temp.vis(array['fol', 'fr', 'grp', 'pub'], array[:'p2fol', :'p2fr', :'p2grp', :'p2pub']::uuid[]), '{}'::text[], 'matrix: private author x pending follower');
set local request.jwt.claims = :'j5';
select is(pg_temp.vis(array['fol', 'fr', 'grp', 'pub'], array[:'p1fol', :'p1fr', :'p1grp', :'p1pub']::uuid[]), array['fol', 'pub'], 'matrix: public author x accepted follower');
select is(pg_temp.vis(array['fol', 'fr', 'grp', 'pub'], array[:'p2fol', :'p2fr', :'p2grp', :'p2pub']::uuid[]), array['fol', 'pub'], 'matrix: private author x accepted follower');
set local request.jwt.claims = :'j6';
select is(pg_temp.vis(array['fol', 'fr', 'grp', 'pub'], array[:'p1fol', :'p1fr', :'p1grp', :'p1pub']::uuid[]), array['fol', 'fr', 'pub'], 'matrix: public author x friend');
select is(pg_temp.vis(array['fol', 'fr', 'grp', 'pub'], array[:'p2fol', :'p2fr', :'p2grp', :'p2pub']::uuid[]), array['fol', 'fr', 'pub'], 'matrix: private author x friend');
set local request.jwt.claims = :'j7';
select is(pg_temp.vis(array['fol', 'fr', 'grp', 'pub'], array[:'p1fol', :'p1fr', :'p1grp', :'p1pub']::uuid[]), '{}'::text[], 'matrix: public author x blocked');
select is(pg_temp.vis(array['fol', 'fr', 'grp', 'pub'], array[:'p2fol', :'p2fr', :'p2grp', :'p2pub']::uuid[]), '{}'::text[], 'matrix: private author x blocked');
set local request.jwt.claims = :'j8';
select is(pg_temp.vis(array['fol', 'fr', 'grp', 'pub'], array[:'p1fol', :'p1fr', :'p1grp', :'p1pub']::uuid[]), array['grp', 'pub'], 'matrix: public author x group member');
select is(pg_temp.vis(array['fol', 'fr', 'grp', 'pub'], array[:'p2fol', :'p2fr', :'p2grp', :'p2pub']::uuid[]), array['grp'], 'matrix: private author x group member');
set local request.jwt.claims = :'j9';
select is(pg_temp.vis(array['fol', 'fr', 'grp', 'pub'], array[:'p1fol', :'p1fr', :'p1grp', :'p1pub']::uuid[]), '{}'::text[], 'matrix: a non-social user sees nothing');
-- profile matrix (private account pia)
set local request.jwt.claims = :'j3';
select is((select row(relation, can_view)::text from public.social_profile(:'s2')), '(none,f)', 'profile: private x stranger -> header only');
select is((select row(relation, can_view)::text from public.social_profile(:'s1')), '(none,t)', 'profile: public x stranger -> visible');
set local request.jwt.claims = :'j4';
select is((select row(relation, can_view)::text from public.social_profile(:'s2')), '(requested,f)', 'profile: private x pending follower');
set local request.jwt.claims = :'j5';
select is((select row(relation, can_view)::text from public.social_profile(:'s2')), '(following,t)', 'profile: private x accepted follower');
set local request.jwt.claims = :'j6';
select is((select row(relation, can_view, follows_me)::text from public.social_profile(:'s2')), '(friends,t,t)', 'profile: private x friend');
set local request.jwt.claims = :'j7';
select is((select count(*)::int from public.social_profile(:'s2')), 0, 'profile: blocked users do not see each other');
set local request.jwt.claims = :'j8';
select is((select row(relation, can_view)::text from public.social_profile(:'s2')), '(none,f)', 'profile: private x group member');
set local request.jwt.claims = :'j9';
select is((select count(*)::int from public.social_profile(:'s1')), 0, 'profile: a non-social user sees no profile');
set local request.jwt.claims = :'j3';
select is((select array_agg(k order by k) from public.social_profile('00000000-0000-0000-0000-000000000101') g, jsonb_object_keys(to_jsonb(g)) k),
  array['avatar_path', 'badges', 'bio', 'can_view', 'display_name', 'followers_count', 'following_count', 'follows_me', 'incoming_request',
        'is_private', 'level', 'posts_count', 'relation', 'user_id', 'username'], 'profile: only public fields');
-- feeds, lists, search
set local request.jwt.claims = :'j5';
select is((select count(*)::int from public.social_feed()), 4, 'feed: the visible posts of followed accounts');
select is((select count(*)::int from public.social_followers(:'s2')), 2, 'lists: followers of a followed private account (pending excluded)');
set local request.jwt.claims = :'j8';
select is((select array_agg(body order by body) from public.social_feed()), array['p1 group', 'p2 group'], 'feed: group posts reach members');
select is((select count(*)::int from public.social_group_posts(:'gc')), 2, 'groups: members read the closed group''s posts');
set local request.jwt.claims = :'j3';
select is((select array_agg(body) from public.social_discover()), array['p1 public'], 'discover: only public posts of public accounts');
select is((select count(*)::int from public.social_user_posts(:'s2')), 0, 'lists: a private account''s posts are closed to strangers');
select is((select count(*)::int from public.social_followers(:'s2')), 0, 'lists: a private account''s followers are closed to strangers');
select is((select count(*)::int from public.social_followers(:'s1')), 2, 'lists: a public account''s followers (blocked removed)');
select is((select count(*)::int from public.social_group_posts(:'gc')), 0, 'groups: non-members read no closed group posts');
select is((select count(*)::int from public.social_search_users('sam')), 1, 'search: finds discoverable users');
set local request.jwt.claims = :'j7';
select is((select count(*)::int from public.social_search_users('sam')), 0, 'search: blocked users are not found');
select is((select count(*)::int from public.social_group(:'go')), 0, 'groups: a group whose owner blocked you is invisible');
set local request.jwt.claims = :'j1';
select ok(not exists (select 1 from public.social_group_members(:'go') where user_id = :'s7'), 'groups: blocked users are hidden in member lists');
set local request.jwt.claims = :'j9';
select ok((select count(*) from public.social_feed()) = 0 and (select count(*) from public.social_search_users('sam')) = 0
          and (select count(*) from public.social_discover()) = 0, 'social: a non-social user gets empty feeds and search');

-- Media and Storage -----------------------------------------------------------------------
set local request.jwt.claims = :'j1';
select public.social_create_post('photo', null, null, 'public') as p1ph \gset
select :'s1' || '/' || :'p1ph' || '/aaaaaaaa-0000-4000-8000-00000000000' as m1pre \gset
set local request.jwt.claims = :'j3';
select is(public.can_view_post(:'p1ph'), false, 'media: a photo post without media is hidden');
set local request.jwt.claims = :'j1';
select lives_ok(format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)', 'social-media', :'m1pre' || '1.jpg', :'s1'),
  'storage: the author uploads under <uid>/<post>/');
select throws_ok(format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)', 'social-media',
  :'s2' || '/' || :'p2pub' || '/aaaaaaaa-0000-4000-8000-000000000099.jpg', :'s1'), '42501', null, 'storage: no uploads into another user''s prefix');
select throws_ok(format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)', 'social-media', :'s1' || '/' || :'p1ph' || '/x.png', :'s1'),
  '42501', null, 'storage: malformed object names are refused');
select throws_ok(format('insert into public.post_media (post_id, author_id, path, width, height, position) values (%L, %L, %L, 10, 10, 1)',
  :'p1ph', :'s1', :'m1pre' || '2.jpg'), '42501', null, 'media: a row needs the uploaded object');
select lives_ok(format('insert into public.post_media (post_id, author_id, path, width, height, position) values (%L, %L, %L, 1280, 960, 0)',
  :'p1ph', :'s1', :'m1pre' || '1.jpg'), 'media: the author attaches the uploaded image');
select lives_ok(format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L), (%L, %L, %L), (%L, %L, %L)',
  'social-media', :'m1pre' || '2.jpg', :'s1', 'social-media', :'m1pre' || '3.jpg', :'s1', 'social-media', :'m1pre' || '4.jpg', :'s1'),
  'storage: up to four images per post');
select throws_ok(format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)', 'social-media', :'m1pre' || '5.jpg', :'s1'),
  '42501', null, 'storage: a fifth image is refused');
set local request.jwt.claims = :'j3';
select throws_ok(format('insert into public.post_media (post_id, author_id, path, width, height, position) values (%L, %L, %L, 10, 10, 1)',
  :'p1ph', :'s1', :'m1pre' || '2.jpg'), '42501', null, 'media: only the author attaches media');
select is(public.can_view_post(:'p1ph'), true, 'media: the photo post is visible once it has media');
set local request.jwt.claims = :'j2';
select public.social_create_post('progress', null, null, 'followers') as p2ph \gset
select :'s2' || '/' || :'p2ph' || '/bbbbbbbb-0000-4000-8000-00000000000' as m2pre \gset
select lives_ok(format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L), (%L, %L, %L)',
  'social-media', :'m2pre' || '1.jpg', :'s2', 'social-media', :'m2pre' || '2.jpg', :'s2'), 'storage: pia uploads two images');
insert into public.post_media (post_id, author_id, path, width, height, position) values (:'p2ph', :'s2', :'m2pre' || '1.jpg', 800, 800, 0);
reset role;
update public.posts set created_at = now() - interval '11 minutes' where id = :'p2ph';
set local role authenticated;
set local request.jwt.claims = :'j2';
select throws_ok(format('insert into public.post_media (post_id, author_id, path, width, height, position) values (%L, %L, %L, 10, 10, 1)',
  :'p2ph', :'s2', :'m2pre' || '2.jpg'), '42501', null, 'media: attaching closes 10 minutes after the post');
set local request.jwt.claims = :'j3';
select is((select count(*)::int from storage.objects where bucket_id = 'social-media'), 4, 'storage matrix: a stranger reads only the public post''s images');
set local request.jwt.claims = :'j4';
select is((select count(*)::int from storage.objects where bucket_id = 'social-media'), 4, 'storage matrix: a pending follower reads nothing of the private account');
set local request.jwt.claims = :'j5';
select is((select count(*)::int from storage.objects where bucket_id = 'social-media'), 6, 'storage matrix: an accepted follower reads both');
set local request.jwt.claims = :'j7';
select is((select count(*)::int from storage.objects where bucket_id = 'social-media'), 0, 'storage matrix: a blocked user reads nothing');
set local request.jwt.claims = :'j9';
select is((select count(*)::int from storage.objects where bucket_id = 'social-media'), 0, 'storage matrix: a non-social user reads nothing');
set local request.jwt.claims = :'j5';
select is((select jsonb_array_length(media) from public.social_post(:'p2ph')), 1, 'media: post rows carry their media paths');

-- Likes ----------------------------------------------------------------------------------------
select is(public.social_like(:'p1pub'), 1, 'likes: like_count goes up');
set local request.jwt.claims = :'j6';
select is(public.social_like(:'p1pub'), 2, 'likes: a second like');
select is(public.social_like(:'p1pub'), 2, 'likes: liking twice changes nothing');
select is((select count(*)::int from public.post_likes), 1, 'likes: post_likes shows only own likes');
set local request.jwt.claims = :'j5';
select is(public.social_unlike(:'p1pub'), 1, 'likes: unlike lowers like_count');
set local request.jwt.claims = :'j3';
select throws_ok(format('select public.social_like(%L)', :'p2fol'), 'P0001', 'NOT_FOUND', 'likes: invisible posts cannot be liked');
reset role;
select is((select count(*)::int from public.social_notifications where user_id = :'s1' and kind = 'like' and post_id = :'p1pub'), 1,
  'notifications: likes collapse to one per post per hour');

-- Payload validation ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'j3';
select lives_ok($$ select public.social_create_post('workout', 'leg day', '{"date":"2026-11-01","duration_sec":3600,"volume_kg":5000,"sets":20,"exercises":[{"name":"Squat","best":{"reps":5,"weight_kg":100}}]}', 'public') $$,
  'payload: a valid workout snapshot');
select lives_ok($$ select public.social_create_post('program', null, '{"name":"PPL","days":[{"name":"Push","exercises":[{"name":"Bench","exercise_id":"abc","sets":3,"reps_low":8,"reps_high":12}]}]}', 'public') $$,
  'payload: a valid program snapshot');
select throws_ok($$ select public.social_create_post('workout', null, '{"date":"2026-11-01","duration_sec":1,"volume_kg":1,"sets":1,"exercises":[],"notes":"x"}') $$,
  '22023', 'BAD_PAYLOAD', 'payload: unexpected top-level keys are refused');
select throws_ok($$ select public.social_create_post('workout', null, '{"date":"2026-11-01","duration_sec":1,"volume_kg":1,"sets":1,"exercises":[{"name":"x","weight":1}]}') $$,
  '22023', 'BAD_PAYLOAD', 'payload: unexpected nested keys are refused');
select throws_ok($$ select public.social_create_post('meal', null, '{"protein_g":1,"carb_g":1,"fat_g":1}') $$, '22023', 'BAD_PAYLOAD', 'payload: meal needs kcal');
select throws_ok($$ select public.social_create_post('text', 'hi', '{"a":1}') $$, '22023', 'BAD_PAYLOAD', 'payload: text posts carry no payload');
select throws_ok($$ select public.social_create_post('meal', null, jsonb_build_object('kcal', 1, 'protein_g', 1, 'carb_g', 1, 'fat_g', 1, 'name', repeat('x', 17000))) $$,
  '22023', 'BAD_PAYLOAD', 'payload: oversized payloads are refused');
select throws_ok($$ select public.social_create_post('text', repeat('x', 1001)) $$, '22023', 'BAD_BODY', 'payload: body is at most 1000 characters');
select throws_ok($$ select public.social_create_post('text', '   ') $$, '22023', 'BAD_BODY', 'payload: a text post needs a body');
select throws_ok($$ select public.social_create_post('text', 'x', null, 'group') $$, '22023', 'BAD_AUDIENCE', 'payload: group audience needs a group');
select throws_ok(format('select public.social_create_post(%L, %L, null, %L, %L)', 'text', 'x', 'group', :'gc'), 'P0001', 'NOT_GROUP_MEMBER',
  'payload: only members post to a group');

-- Rate limits ------------------------------------------------------------------------------
do $$ begin for i in 1..18 loop perform public.social_create_post('text', 'spam ' || i); end loop; end $$;
select throws_ok($$ select public.social_create_post('text', 'one more') $$, 'P0001', 'RATE_LIMITED', 'rate: 20 posts a day');
reset role;
insert into public.posts (author_id, kind, body, audience) select :'s9', 'text', 'bulk', 'public' from generate_series(1, 200);
insert into public.post_likes (post_id, user_id) select id, :'s3' from public.posts where author_id = :'s9';
insert into public.social_notifications (user_id, kind, actor_id) select :'s9', 'follow', :'s3' from generate_series(1, 50);
insert into public.reports (reporter_id, target_kind, target_id) select :'s3', 'user', gen_random_uuid() from generate_series(1, 20);
set local role authenticated;
set local request.jwt.claims = :'j3';
select throws_ok(format('select public.social_like(%L)', :'p1pub'), 'P0001', 'RATE_LIMITED', 'rate: 200 likes a day');
select throws_ok(format('select public.social_follow(%L)', :'s1'), 'P0001', 'RATE_LIMITED', 'rate: 50 follow actions a day');
select throws_ok(format('select public.social_report(%L, %L, %L)', 'post', :'p1pub', 'spam'), 'P0001', 'RATE_LIMITED', 'rate: 20 reports a day');

-- Clients never write social tables directly -------------------------------------------------
select throws_ok($$ insert into public.posts (author_id, kind, body) values ('00000000-0000-0000-0000-000000000103', 'text', 'x') $$, '42501', null,
  'direct: posts are created only through social_create_post');
select throws_ok($$ insert into public.social_notifications (user_id, kind) values ('00000000-0000-0000-0000-000000000101', 'follow') $$, '42501', null,
  'direct: notifications are written only by triggers');
select throws_ok($$ update public.follows set status = 'accepted' $$, '42501', null, 'direct: follows change only through RPCs');
select is((select count(*)::int from public.posts where author_id <> '00000000-0000-0000-0000-000000000103'), 0, 'direct: the posts table shows only own rows');

-- Reports and moderation ---------------------------------------------------------------------
set local request.jwt.claims = :'j4';
select lives_ok(format('select public.social_report(%L, %L, %L)', 'post', :'p1ph', 'nsfw'), 'reports: a user reports a post');
select throws_ok($$ select * from public.admin_list_reports() $$, '42501', 'FORBIDDEN', 'reports: the queue is admin-only');
set local request.jwt.claims = :'jwt_a';
select is((select target ->> 'kind' from public.admin_list_reports() where target_id = :'p1ph'), 'photo', 'reports: the admin sees the reported post');
select is((select count(*)::int from storage.objects where bucket_id = 'social-media' and name like :'s1' || '/' || :'p1ph' || '/%'), 4,
  'reports: the admin can open the reported post''s images');

-- Notifications ------------------------------------------------------------------------------
set local request.jwt.claims = :'j1';
select ok((select count(*) from public.social_notifications_list()) >= 3
          and not exists (select 1 from public.social_notifications_list() where actor_id = :'s7'), 'notifications: listed, none from blocked users');
select ok(public.social_mark_read(null) >= 3, 'notifications: mark all read');
select is(public.social_unread_count(), 0, 'notifications: nothing unread after marking');

-- Push ----------------------------------------------------------------------------------------
reset role;
update public.social_notifications set read_at = null where user_id = :'s1';
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  (:'s1', 'https://fcm.googleapis.com/fcm/send/social-s1', 'k', 'a'), (:'s2', 'https://fcm.googleapis.com/fcm/send/social-s2', 'k', 'a');
set local role authenticated;
set local request.jwt.claims = :'j2';
update public.user_settings set social_push = false;
reset role;
select is((select social_push from public.user_settings where user_id = :'s2'), false, 'push: social_push is a user setting');
select pg_temp.social_msgs() as social_before \gset
select public.dispatch_reminders();
select is(pg_temp.social_msgs() - :social_before, 1, 'push: one collapsed social push (only sam; pia turned it off)');
select ok(exists (select 1 from net.http_request_queue q
                   cross join lateral jsonb_array_elements(convert_from(q.body, 'UTF8')::jsonb -> 'messages') m
                   where m -> 'payload' ->> 'tag' = 'social' and m ->> 'endpoint' like '%social-s1'
                     and m -> 'payload' ->> 'body' ~ '^[0-9]+ yeni bildirim$'), 'push: "N yeni bildirim" goes to sam''s device');
select ok(not exists (select 1 from public.social_notifications where user_id = :'s1' and pushed_at is null)
      and exists (select 1 from public.social_notifications where user_id = :'s2' and pushed_at is null), 'push: pushed_at marks delivered notifications only');
insert into public.social_notifications (user_id, kind, actor_id) values (:'s1', 'follow', :'s8');
select public.dispatch_reminders();
select is(pg_temp.social_msgs() - :social_before, 1, 'push: at most one social push per user per 10 minutes');

-- Going public accepts requests ----------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'j2';
select public.social_update_settings(false);
reset role;
select ok((select status from public.follows where follower_id = :'s4' and followee_id = :'s2') = 'accepted'
          and exists (select 1 from public.social_notifications where user_id = :'s4' and kind = 'follow_accepted'),
  'follow: switching to public accepts pending requests');

-- Under-18 birth year auto-disables -------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'j6';
select public.social_create_post('text', 'fred post', null, 'public');
update public.profile_private set birth_year = extract(year from current_date)::int - 10;
reset role;
select ok((select not enabled from public.social_profiles where user_id = :'s6')
          and not exists (select 1 from public.posts where author_id = :'s6')
          and not exists (select 1 from public.follows where :'s6' in (follower_id, followee_id))
          and exists (select 1 from public.user_consents where user_id = :'s6' and kind = 'social' and not granted),
  'age: a birth year under 18 closes social and deletes its data');
set local role authenticated;
select throws_ok($$ select public.social_enable('2026-11-01') $$, 'P0001', 'SOCIAL_UNDERAGE', 'age: social cannot be re-enabled');

-- Owner leaves a group -> ownership transfers ---------------------------------------------------
set local request.jwt.claims = :'j1';
select lives_ok(format('select public.group_leave(%L)', :'gc'), 'groups: the owner leaves');
reset role;
select ok((select owner_id from public.groups where id = :'gc') = :'s2'
          and (select role from public.group_members where group_id = :'gc' and user_id = :'s2') = 'owner',
  'groups: ownership goes to the oldest admin');

-- Leaving social deletes everything ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'j1';
select lives_ok($$ select public.social_disable(true) $$, 'leave: sam leaves the social side');
reset role;
select ok(not exists (select 1 from public.posts where author_id = :'s1')
          and not exists (select 1 from public.post_likes where user_id = :'s1')
          and not exists (select 1 from public.follows where :'s1' in (follower_id, followee_id))
          and not exists (select 1 from public.social_notifications where :'s1' in (user_id, actor_id))
          and not exists (select 1 from public.group_members where user_id = :'s1')
          and (select not enabled and bio is null from public.social_profiles where user_id = :'s1'),
  'leave: posts, likes, follows, memberships and notifications are deleted');
select is((select owner_id from public.groups where id = :'go'), :'s3'::uuid, 'leave: owned groups go to the oldest member');
select is((select count(*)::int from private.storage_garbage where bucket = 'social-media' and path like :'s1' || '/%'), 4,
  'leave: every media object is queued in storage_garbage');
select ok(exists (select 1 from public.user_consents where user_id = :'s1' and kind = 'social' and not granted), 'leave: the withdrawal is logged');
set local role authenticated;
set local request.jwt.claims = :'j5';
select is((select count(*)::int from public.social_profile(:'s1')), 0, 'leave: the user disappears for everyone');

-- Account deletion queues media too -------------------------------------------------------------
reset role;
delete from auth.users where id = :'s2';
select is((select count(*)::int from private.storage_garbage where path like :'s2' || '/%'), 2, 'account deletion: media objects are queued');
select is((select owner_id from public.groups where id = :'gc'), :'s8'::uuid, 'account deletion: group ownership transfers');
select count(*) as claimed from public.ops_claim_storage_garbage(1000) \gset
select ok(:claimed >= 6 and not exists (select 1 from private.storage_garbage),
  'ops_claim_storage_garbage returns and deletes the queue');

-- =============================================================================
-- Social hardening (20261160000000). State: sam left, pia deleted, fred under 18; go owned by sid
-- (members sid, fay; bart removed + banned when sam blocked him), gc owned by gus.
-- =============================================================================
reset role;
select ok(has_function_privilege('authenticated', 'public.group_unban(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.group_bans_list(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.group_remove_member(uuid, uuid, boolean)', 'execute')
  and to_regprocedure('public.group_remove_member(uuid, uuid)') is null
  and not has_function_privilege('authenticated', 'private.social_activity_bump(uuid, text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'private.social_activity_count(uuid, text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'private.social_log_post()', 'execute')
  and not has_function_privilege('authenticated', 'private.social_log_like()', 'execute')
  and not has_function_privilege('authenticated', 'private.group_banned(uuid, uuid)', 'execute')
  and not has_table_privilege('authenticated', 'private.social_activity', 'select')
  and not has_table_privilege('authenticated', 'public.group_bans', 'select')
  and (select relrowsecurity from pg_class where oid = 'public.group_bans'::regclass),
  'hardening: new RPCs granted, helpers and tables internal, group_bans has RLS');
select ok(exists (select 1 from public.group_bans where group_id = :'go' and user_id = :'s7')
          and not exists (select 1 from public.group_members where group_id = :'go' and user_id = :'s7'),
  'hardening: blocking removed and banned the blocked user from the blocker''s group');

-- 4. Payload validation
create function pg_temp.hw(ex jsonb) returns jsonb language sql as $f$
  select jsonb_build_object('date', '2026-11-01', 'duration_sec', 1, 'volume_kg', 1, 'sets', 1, 'exercises', ex)
$f$;
select is(
  (select coalesce(array_agg(x.label order by x.label), '{}') from (values
     ('best string', 'workout', pg_temp.hw('[{"name":"x","best":"100x5"}]'::jsonb)),
     ('best extra key', 'workout', pg_temp.hw('[{"name":"x","best":{"reps":1,"weight_kg":1,"rpe":9}}]'::jsonb)),
     ('best no weight', 'workout', pg_temp.hw('[{"name":"x","best":{"reps":1}}]'::jsonb)),
     ('best reps 1001', 'workout', pg_temp.hw('[{"name":"x","best":{"reps":1001,"weight_kg":1}}]'::jsonb)),
     ('best weight 2001', 'workout', pg_temp.hw('[{"name":"x","best":{"reps":1,"weight_kg":2001}}]'::jsonb)),
     ('best reps text', 'workout', pg_temp.hw('[{"name":"x","best":{"reps":"5","weight_kg":1}}]'::jsonb)),
     ('best null', 'workout', pg_temp.hw('[{"name":"x","best":null}]'::jsonb)),
     ('duration text', 'workout', pg_temp.hw('[]'::jsonb) || '{"duration_sec":"60"}'::jsonb),
     ('ex name 121', 'workout', pg_temp.hw(jsonb_build_array(jsonb_build_object('name', repeat('x', 121))))),
     ('ex 31', 'workout', pg_temp.hw((select jsonb_agg(jsonb_build_object('name', 'e' || i)) from generate_series(1, 31) i))),
     ('ok ex 30', 'workout', pg_temp.hw((select jsonb_agg(jsonb_build_object('name', 'e' || i, 'best', jsonb_build_object('reps', 5, 'weight_kg', 2000)))
                                           from generate_series(1, 30) i))),
     ('days 8', 'program', jsonb_build_object('name', 'P', 'days', (select jsonb_agg(jsonb_build_object('name', 'd', 'exercises', '[]'::jsonb)) from generate_series(1, 8)))),
     ('ok days 7', 'program', jsonb_build_object('name', 'P', 'days', (select jsonb_agg(jsonb_build_object('name', 'd', 'exercises', '[]'::jsonb)) from generate_series(1, 7)))),
     ('day ex 31', 'program', jsonb_build_object('name', 'P', 'days', jsonb_build_array(jsonb_build_object('name', 'd', 'exercises',
        (select jsonb_agg(jsonb_build_object('name', 'e', 'sets', 3, 'reps_low', 8, 'reps_high', 12)) from generate_series(1, 31)))))),
     ('program sets text', 'program', '{"name":"P","days":[{"name":"d","exercises":[{"name":"e","sets":"3","reps_low":8,"reps_high":12}]}]}'::jsonb),
     ('meal kcal 50001', 'meal', '{"kcal":50001,"protein_g":1,"carb_g":1,"fat_g":1}'::jsonb),
     ('meal name 121', 'meal', jsonb_build_object('kcal', 1, 'protein_g', 1, 'carb_g', 1, 'fat_g', 1, 'name', repeat('x', 121)))
   ) x(label, kind, p) where private.social_payload_valid(x.kind, x.p)),
  array['ok days 7', 'ok ex 30'], 'payload: types, bounds and array lengths are enforced (best = {reps, weight_kg})');
set local role authenticated;
set local request.jwt.claims = :'j8';
select lives_ok($$ select public.social_create_post('workout', null, '{"date":"2026-11-01","duration_sec":60,"volume_kg":0,"sets":1,"exercises":[{"name":"Pull-up","best":{"reps":8,"weight_kg":null}}]}', 'public') $$,
  'payload: best with a null weight (bodyweight)');
select throws_ok($$ select public.social_create_post('workout', null, '{"date":"2026-11-01","duration_sec":60,"volume_kg":0,"sets":1,"exercises":[{"name":"Squat","best":"100x5"}]}', 'public') $$,
  '22023', 'BAD_PAYLOAD', 'payload: a free-form best is refused');

-- 2. Group posts of private accounts reach members only; member lists only for members
select public.group_join(:'go');
select public.social_update_settings(false);
select public.social_create_post('text', 'gus open group', null, 'group', :'go') as h_pub \gset
set local request.jwt.claims = :'j5';
select public.social_create_post('text', 'fay open group', null, 'group', :'go') as h_priv \gset
set local request.jwt.claims = :'j4';
select is(pg_temp.vis(array['priv', 'pub'], array[:'h_priv', :'h_pub']::uuid[]), array['pub'], 'groups: a non-member sees only public accounts'' open-group posts');
select is((select count(*)::int from public.social_group_members(:'go')), 0, 'groups: open-group member lists are hidden from non-members');
select is((select member_count from public.social_group(:'go')), 3, 'groups: non-members still see the member count');
set local request.jwt.claims = :'j3';
select is(pg_temp.vis(array['priv', 'pub'], array[:'h_priv', :'h_pub']::uuid[]), array['priv', 'pub'], 'groups: members see private accounts'' group posts');
select is((select count(*)::int from public.social_group_members(:'go')), 3, 'groups: members see the member list');

-- 3. Bans
reset role;
select invite_code as h_code from public.groups where id = :'gc' \gset
set local role authenticated;
set local request.jwt.claims = :'j4';
select is(public.group_join_by_code(:'h_code'), :'gc'::uuid, 'bans: pen joins the closed group by code');
set local request.jwt.claims = :'j5';
select public.group_join_by_code(:'h_code');
select throws_ok(format('select * from public.group_bans_list(%L)', :'gc'), '42501', 'FORBIDDEN', 'bans: members cannot list bans');
set local request.jwt.claims = :'j8';
select lives_ok(format('select public.group_remove_member(%L, %L)', :'gc', :'s4'), 'bans: removing a member bans by default');
select lives_ok(format('select public.group_remove_member(%L, %L, false)', :'gc', :'s5'), 'bans: removing without a ban');
select is((select array_agg(user_id) from public.group_bans_list(:'gc')), array[:'s4'::uuid], 'bans: admins list bans');
select throws_ok(format('select public.group_invite(%L, %L)', :'gc', :'s4'), 'P0001', 'USER_BANNED', 'bans: a banned user cannot be invited');
set local request.jwt.claims = :'j4';
select throws_ok(format('select public.group_join_by_code(%L)', :'h_code'), 'P0001', 'GROUP_BANNED', 'bans: the old code no longer works');
select throws_ok(format('select public.group_join(%L)', :'gc'), 'P0001', 'GROUP_BANNED', 'bans: no join request either');
select throws_ok(format('select public.group_unban(%L, %L)', :'gc', :'s4'), '42501', 'FORBIDDEN', 'bans: only admins unban');
set local request.jwt.claims = :'j5';
select is(public.group_join_by_code(:'h_code'), :'gc'::uuid, 'bans: a member removed without a ban can rejoin');
set local request.jwt.claims = :'j8';
select lives_ok(format('select public.group_unban(%L, %L)', :'gc', :'s4'), 'bans: the owner unbans');
set local request.jwt.claims = :'j4';
select is(public.group_join_by_code(:'h_code'), :'gc'::uuid, 'bans: after unbanning the code works again');

-- 5. join-by-code attempt limit
set local request.jwt.claims = :'j5';
select is((select count(*)::int from generate_series(1, 20) i where public.group_join_by_code('ZZZZZZZZZZ') is null), 20,
  'join code: a wrong code returns null and is logged');
select throws_ok(format('select public.group_join_by_code(%L)', :'h_code'), 'P0001', 'RATE_LIMITED', 'join code: 20 failed attempts per hour');

-- 6. Like/unlike repeats count against the daily cap
set local request.jwt.claims = :'j4';
select is((select count(*)::int from (select public.social_like(:'h_pub') l, public.social_unlike(:'h_pub') u from generate_series(1, 200)) s
            where l >= 0 and u >= 0), 200, 'likes: 200 like/unlike cycles');
select throws_ok(format('select public.social_like(%L)', :'h_pub'), 'P0001', 'RATE_LIMITED', 'rate: unliking does not reset 200 likes a day');

-- 1. Deleted posts still count; daily upload cap per owner
do $$ begin for i in 1..20 loop perform public.social_delete_post(public.social_create_post('text', 'temp ' || i)); end loop; end $$;
select is((select count(*)::int from public.posts), 0, 'rate: the deleted posts are gone');
select throws_ok($$ select public.social_create_post('text', 'again') $$, 'P0001', 'RATE_LIMITED', 'rate: deleting posts does not reset 20 posts a day');
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'social-media', :'s8' || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '.jpg', :'s8', '{"size": 1000}'::jsonb
  from generate_series(1, 40);
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('social-media', :'s7' || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '.jpg', :'s7', '{"size": 20971520}'::jsonb);
set local role authenticated;
set local request.jwt.claims = :'j8';
select public.social_create_post('photo', null, null, 'public') as h_ph8 \gset
select throws_ok(format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)', 'social-media',
  :'s8' || '/' || :'h_ph8' || '/cccccccc-0000-4000-8000-000000000001.jpg', :'s8'), '42501', null, 'storage: at most 40 uploads per user per day');
set local request.jwt.claims = :'j7';
select public.social_create_post('photo', null, null, 'public') as h_ph7 \gset
select throws_ok(format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)', 'social-media',
  :'s7' || '/' || :'h_ph7' || '/cccccccc-0000-4000-8000-000000000002.jpg', :'s7'), '42501', null, 'storage: at most 20 MB of uploads per user per day');
set local request.jwt.claims = :'j5';
select public.social_create_post('photo', null, null, 'public') as h_ph5 \gset
select lives_ok(format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)', 'social-media',
  :'s5' || '/' || :'h_ph5' || '/cccccccc-0000-4000-8000-000000000003.jpg', :'s5'), 'storage: uploads under the daily cap still work');

-- 7. Blocking removes and bans from groups the blocker owns (anyone but self) or administers (plain members)
set local request.jwt.claims = :'j3';
select public.group_set_role(:'go', :'s5', 'admin');
set local request.jwt.claims = :'j4';
select public.group_join(:'go');
set local request.jwt.claims = :'j5';
select public.social_block(:'s4');
select public.social_block(:'s3');
set local request.jwt.claims = :'j3';
select public.social_block(:'s5');
set local request.jwt.claims = :'j4';
select throws_ok(format('select public.group_join(%L)', :'go'), 'P0001', 'GROUP_BANNED', 'block: an admin''s block bans a plain member');
reset role;
select ok((select array_agg(user_id order by user_id) from public.group_members where group_id = :'go') = array[:'s3', :'s8']::uuid[]
          and (select count(*) from public.group_bans where group_id = :'go' and user_id in (:'s4', :'s5')) = 2,
  'block: the owner''s block removes an admin; an admin''s block never removes the owner');

-- =============================================================================
-- Hashtags (20261170000000). Fresh users: hana (public author), hugo (stranger), hale (hana's friend),
-- hans (blocked by hana), hira (private account), halil (public, not discoverable).
-- =============================================================================
reset role;
set local request.jwt.claims = '';
\set h1 '00000000-0000-0000-0000-000000000201'
\set h2 '00000000-0000-0000-0000-000000000202'
\set h3 '00000000-0000-0000-0000-000000000203'
\set h4 '00000000-0000-0000-0000-000000000204'
\set h5 '00000000-0000-0000-0000-000000000205'
\set h6 '00000000-0000-0000-0000-000000000206'
\set k1 '{"sub":"00000000-0000-0000-0000-000000000201","role":"authenticated"}'
\set k2 '{"sub":"00000000-0000-0000-0000-000000000202","role":"authenticated"}'
\set k3 '{"sub":"00000000-0000-0000-0000-000000000203","role":"authenticated"}'
\set k4 '{"sub":"00000000-0000-0000-0000-000000000204","role":"authenticated"}'
\set k5 '{"sub":"00000000-0000-0000-0000-000000000205","role":"authenticated"}'
\set k6 '{"sub":"00000000-0000-0000-0000-000000000206","role":"authenticated"}'

-- Tag rule (internal helper)
select is(private.post_tag_list('Leg day #LegDay #legday #Squat'), array['legday', 'squat'], 'tags: lower-cased, distinct, in order');
select is(private.post_tag_list('#İstanbul #IĞDIR #ÇALIŞ_1 #şöü'), array['istanbul', 'ığdır', 'çalış_1', 'şöü'],
  'tags: Turkish normalisation (İ -> i, I -> ı)');
select is(private.post_tag_list('a#bc &#abc; &#39; #1234 #x #-ab mail#ok'), '{}'::text[],
  'tags: preceded by a word char or &, all digits, one char -> not tags');
select is(private.post_tag_list('##ab (#cd) #123abc #a_1'), array['ab', 'cd', '123abc', 'a_1'], 'tags: punctuation before #, digits plus letters');
select is(private.post_tag_list('#' || repeat('a', 30) || ' #' || repeat('b', 31)), array[repeat('a', 30)], 'tags: 30 chars at most; a longer run is not a tag');
select is(private.post_tag_list((select string_agg('#t' || i, ' ' order by i) from generate_series(1, 12) i)),
  (select array_agg('t' || i order by i) from generate_series(1, 10) i), 'tags: at most 10 per post');
select is(private.post_tag_list(null), '{}'::text[], 'tags: a null body has no tags');
select ok(private.tag_parse('#İSTANBUL') = 'istanbul' and private.tag_parse(' legday ') = 'legday'
          and private.tag_parse('#12') is null and private.tag_parse('#a') is null and private.tag_parse('a b') is null,
  'tags: a typed tag is normalised; invalid input is null');
select is((select count(*)::int from public.posts p
            where coalesce((select array_agg(t order by t) from unnest(private.post_tag_list(p.body)) t), '{}')
                  is distinct from coalesce((select array_agg(pt.tag order by pt.tag) from public.post_tags pt where pt.post_id = p.id), '{}')),
  0, 'tags: post_tags matches the tag rule for every existing post');
select ok(has_function_privilege('authenticated', 'public.social_tag_posts(text, timestamptz, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.social_search_tags(text)', 'execute')
  and not has_function_privilege('anon', 'public.social_tag_posts(text, timestamptz, integer)', 'execute')
  and not has_function_privilege('anon', 'public.social_search_tags(text)', 'execute')
  and not has_function_privilege('authenticated', 'private.post_tags_sync()', 'execute')
  and not has_function_privilege('authenticated', 'private.post_tag_list(text)', 'execute')
  and not has_function_privilege('authenticated', 'private.tag_parse(text)', 'execute')
  and not has_function_privilege('authenticated', 'private.tag_norm(text)', 'execute')
  and not has_table_privilege('authenticated', 'public.post_tags', 'select')
  and not has_table_privilege('anon', 'public.post_tags', 'select')
  and (select relrowsecurity from pg_class where oid = 'public.post_tags'::regclass),
  'tags: two RPCs granted, helpers and table internal, post_tags has RLS');

update public.app_config set value = 'false'::jsonb where key = 'require_approval';
insert into auth.users (id, email, instance_id, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u.id::uuid, u.n || '@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}', '{}', now(), now()
  from (values (:'h1', 'hana'), (:'h2', 'hugo'), (:'h3', 'hale'), (:'h4', 'hans'), (:'h5', 'hira'), (:'h6', 'halil')) u(id, n);
insert into public.profiles (user_id, username, display_name, avatar_path, onboarding_completed_at)
select u.id::uuid, u.n || '_h', initcap(u.n), u.id || '/avatar.jpg', now()
  from (values (:'h1', 'hana'), (:'h2', 'hugo'), (:'h3', 'hale'), (:'h4', 'hans'), (:'h5', 'hira'), (:'h6', 'halil')) u(id, n);
insert into public.profile_private (user_id, birth_year)
select u.id::uuid, 1990 from (values (:'h1'), (:'h2'), (:'h3'), (:'h4'), (:'h5'), (:'h6')) u(id);
update public.app_config set value = 'true'::jsonb where key = 'require_approval';

set local role authenticated;
set local request.jwt.claims = :'k1'; select public.social_enable('2026-11-01'); select public.social_update_settings(false);
set local request.jwt.claims = :'k2'; select public.social_enable('2026-11-01'); select public.social_update_settings(false);
set local request.jwt.claims = :'k3'; select public.social_enable('2026-11-01'); select public.social_update_settings(false);
select public.social_follow(:'h1');
set local request.jwt.claims = :'k4'; select public.social_enable('2026-11-01'); select public.social_update_settings(false);
select public.social_create_post('text', '#LegDay by hans', null, 'public') as hx \gset
set local request.jwt.claims = :'k5'; select public.social_enable('2026-11-01');
select public.social_create_post('text', '#LegDay from hira #hiraonly', null, 'public') as ip1 \gset
set local request.jwt.claims = :'k6'; select public.social_enable('2026-11-01'); select public.social_update_settings(false, false);
select public.social_create_post('text', '#LegDay #hidden_tag', null, 'public') as lp1 \gset
set local request.jwt.claims = :'k1';
select public.social_follow(:'h3');
select public.social_block(:'h4');
select public.social_create_post('text', 'Morning run #Koşu #LegDay', null, 'public') as hp1 \gset
select public.social_create_post('text', 'Friends only #LegDay #secret', null, 'friends') as hp2 \gset
select public.social_create_post('text', '#LegDay for followers #Koşu', null, 'followers') as hp3 \gset
select throws_ok('select * from public.post_tags', '42501', null, 'tags: no direct select on post_tags');

reset role;
select is((select array_agg(tag order by tag) from public.post_tags where post_id = :'hp1'), array['koşu', 'legday'], 'tags: written on insert');
update public.posts set created_at = now() - (x.h || ' hours')::interval
  from (values (:'hp1', 1), (:'hp2', 2), (:'hp3', 3), (:'ip1', 4), (:'hx', 5), (:'lp1', 6)) x(id, h) where posts.id = x.id::uuid;
select ok(not exists (select 1 from public.post_tags pt join public.posts p on p.id = pt.post_id where pt.created_at <> p.created_at),
  'tags: created_at is a copy of the post''s created_at');
select created_at as hp2_at from public.posts where id = :'hp2' \gset

-- Tag pages and search
set local role authenticated;
set local request.jwt.claims = :'k2';
select is((select array_agg(id) from public.social_tag_posts('#LEGDAY')), array[:'hp1', :'hx']::uuid[],
  'tag posts: a stranger sees public posts of public, discoverable accounts, newest first');
select is(array(select distinct k from public.social_tag_posts('legday') g, jsonb_object_keys(to_jsonb(g)) k order by k),
  array(select distinct k from public.social_discover() g, jsonb_object_keys(to_jsonb(g)) k order by k), 'tag posts: same row shape as discover');
select is((select array_agg(row(tag, post_count)::text) from public.social_search_tags('#Leg')), array['(legday,2)'],
  'tag search: counts only posts the stranger can view');
select is((select count(*)::int from public.social_search_tags('sec')), 0, 'tag search: a tag used only in a friends post is hidden from strangers');
select is((select count(*)::int from public.social_search_tags('hira')), 0, 'tag search: a private account''s tags are hidden from strangers');
select is((select count(*)::int from public.social_search_tags('hidden')), 0, 'tag search: a non-discoverable author''s tags are hidden from strangers');
select is((select count(*)::int from public.social_tag_posts('secret')), 0, 'tag posts: friends posts are not returned to strangers');
select is((select array_agg(row(tag, post_count)::text) from public.social_search_tags('KOŞ')), array['(koşu,1)'],
  'tag search: Turkish query normalised (the followers post is not counted)');
select ok((select count(*) from public.social_search_tags('#')) = 0 and (select count(*) from public.social_search_tags('')) = 0
          and (select count(*) from public.social_search_tags('a b')) = 0 and (select count(*) from public.social_tag_posts('#1')) = 0,
  'tag search: empty or invalid queries return nothing');
select public.social_follow(:'h6');
select is((select count(*)::int from public.social_tag_posts('legday')), 3, 'tag posts: following a non-discoverable author shows their posts');
set local request.jwt.claims = :'k3';
select is((select array_agg(id) from public.social_tag_posts('legday')), array[:'hp1', :'hp2', :'hp3', :'hx']::uuid[],
  'tag posts: a friend sees public, friends and followers posts');
select is((select array_agg(id) from public.social_tag_posts('legday', :'hp2_at')),
  array[:'hp3', :'hx']::uuid[], 'tag posts: keyset pagination by p_before');
select is((select array_agg(id) from public.social_tag_posts('legday', null, 1)), array[:'hp1']::uuid[], 'tag posts: p_limit');
select is((select array_agg(row(tag, post_count)::text order by tag) from public.social_search_tags('s')), array['(secret,1)'],
  'tag search: a friend sees the friends-only tag');
set local request.jwt.claims = :'k1';
select is((select array_agg(id) from public.social_tag_posts('legday')), array[:'hp1', :'hp2', :'hp3']::uuid[],
  'tag posts: the author sees own posts; the blocked user''s post is excluded');
set local request.jwt.claims = :'k4';
select is((select array_agg(id) from public.social_tag_posts('legday')), array[:'hx']::uuid[], 'tag posts: a blocked user sees none of the blocker''s posts');
select is((select array_agg(row(tag, post_count)::text) from public.social_search_tags('leg')), array['(legday,1)'],
  'tag search: a blocked user''s counts exclude the blocker''s posts');
set local request.jwt.claims = :'j9';
select ok((select count(*) from public.social_tag_posts('legday')) = 0 and (select count(*) from public.social_search_tags('leg')) = 0,
  'tags: a non-social user gets empty results, like the other social reads');

-- Update replaces tags, delete cascades
reset role;
update public.posts set body = 'Morning run #Yoga' where id = :'hp1';
select is((select array_agg(tag) from public.post_tags where post_id = :'hp1'), array['yoga'], 'tags: editing the body replaces the tags');
update public.posts set body = 'no tags now' where id = :'hp1';
select is((select count(*)::int from public.post_tags where post_id = :'hp1'), 0, 'tags: removing all tags clears them');
set local role authenticated;
set local request.jwt.claims = :'k1';
select public.social_delete_post(:'hp3');
reset role;
select is((select count(*)::int from public.post_tags where post_id = :'hp3'), 0, 'tags: deleting a post deletes its tags');
set local role authenticated;
set local request.jwt.claims = :'k2';
select is((select array_agg(row(tag, post_count)::text) from public.social_search_tags('leg')), array['(legday,2)'],
  'tag search: counts follow edits (hp1 lost #legday; hans and halil remain)');

-- =============================================================================
-- Mentions (20261180000000). Fresh public users: mia (author), max (follows mia), mel (mia's friend,
-- shown as "İlker Mel"), moe (mia follows moe), mae (stranger), mik (blocked by mia), mur (blocks mia),
-- mona (follows mia, mentions off). Closed group mg (owner mel; members mia, max, mik, mur).
-- =============================================================================
reset role;
set local request.jwt.claims = '';
\set n1 '00000000-0000-0000-0000-000000000301'
\set n2 '00000000-0000-0000-0000-000000000302'
\set n3 '00000000-0000-0000-0000-000000000303'
\set n4 '00000000-0000-0000-0000-000000000304'
\set n5 '00000000-0000-0000-0000-000000000305'
\set n6 '00000000-0000-0000-0000-000000000306'
\set n7 '00000000-0000-0000-0000-000000000307'
\set n8 '00000000-0000-0000-0000-000000000308'
\set q1 '{"sub":"00000000-0000-0000-0000-000000000301","role":"authenticated"}'
\set q2 '{"sub":"00000000-0000-0000-0000-000000000302","role":"authenticated"}'
\set q3 '{"sub":"00000000-0000-0000-0000-000000000303","role":"authenticated"}'
\set q4 '{"sub":"00000000-0000-0000-0000-000000000304","role":"authenticated"}'
\set q5 '{"sub":"00000000-0000-0000-0000-000000000305","role":"authenticated"}'
\set q6 '{"sub":"00000000-0000-0000-0000-000000000306","role":"authenticated"}'
\set q7 '{"sub":"00000000-0000-0000-0000-000000000307","role":"authenticated"}'
\set q8 '{"sub":"00000000-0000-0000-0000-000000000308","role":"authenticated"}'

select ok(has_function_privilege('authenticated', 'public.social_create_post(text, text, jsonb, text, uuid, uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.social_update_settings(boolean, boolean, text, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.social_remove_mention(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.social_mention_candidates(text, text, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.social_mentioned_posts(timestamptz, integer)', 'execute')
  and not has_function_privilege('anon', 'public.social_create_post(text, text, jsonb, text, uuid, uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.social_mention_candidates(text, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.social_mentioned_posts(timestamptz, integer)', 'execute')
  and to_regprocedure('public.social_create_post(text, text, jsonb, text, uuid)') is null
  and to_regprocedure('public.social_update_settings(boolean, boolean, text)') is null
  and not has_function_privilege('authenticated', 'private.mention_ok(uuid, uuid, boolean, text, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.post_audience_ok(uuid, uuid, boolean, text, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.post_mentions_after()', 'execute')
  and not has_function_privilege('authenticated', 'private.post_mentions_revalidate()', 'execute')
  and not has_function_privilege('authenticated', 'private.blocks_drop_mentions()', 'execute')
  and not has_table_privilege('authenticated', 'public.post_mentions', 'select')
  and not has_table_privilege('anon', 'public.post_mentions', 'select')
  and (select relrowsecurity from pg_class where oid = 'public.post_mentions'::regclass),
  'mentions: RPCs granted (old signatures dropped), helpers and table internal, post_mentions has RLS');

update public.app_config set value = 'false'::jsonb where key = 'require_approval';
insert into auth.users (id, email, instance_id, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u.id::uuid, u.n || '@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}', '{}', now(), now()
  from (values (:'n1', 'mia'), (:'n2', 'max'), (:'n3', 'mel'), (:'n4', 'moe'), (:'n5', 'mae'), (:'n6', 'mik'),
               (:'n7', 'mur'), (:'n8', 'mona')) u(id, n);
insert into public.profiles (user_id, username, display_name, avatar_path, onboarding_completed_at)
select u.id::uuid, u.n || '_m', initcap(u.n), u.id || '/avatar.jpg', now()
  from (values (:'n1', 'mia'), (:'n2', 'max'), (:'n3', 'mel'), (:'n4', 'moe'), (:'n5', 'mae'), (:'n6', 'mik'),
               (:'n7', 'mur'), (:'n8', 'mona')) u(id, n);
update public.profiles set display_name = 'İlker Mel' where user_id = :'n3';
insert into public.profile_private (user_id, birth_year)
select u.id::uuid, 1990 from (values (:'n1'), (:'n2'), (:'n3'), (:'n4'), (:'n5'), (:'n6'), (:'n7'), (:'n8')) u(id);
update public.app_config set value = 'true'::jsonb where key = 'require_approval';

set local role authenticated;
set local request.jwt.claims = :'q1'; select public.social_enable('2026-11-01'); select public.social_update_settings(false);
set local request.jwt.claims = :'q2'; select public.social_enable('2026-11-01'); select public.social_update_settings(false);
select public.social_follow(:'n1');
set local request.jwt.claims = :'q3'; select public.social_enable('2026-11-01'); select public.social_update_settings(false);
select public.social_follow(:'n1');
select public.group_create('Mention Crew', null, 'closed') as mg \gset
set local request.jwt.claims = :'q4'; select public.social_enable('2026-11-01'); select public.social_update_settings(false);
set local request.jwt.claims = :'q5'; select public.social_enable('2026-11-01'); select public.social_update_settings(false);
set local request.jwt.claims = :'q6'; select public.social_enable('2026-11-01'); select public.social_update_settings(false);
select public.social_follow(:'n1');
set local request.jwt.claims = :'q7'; select public.social_enable('2026-11-01'); select public.social_update_settings(false);
set local request.jwt.claims = :'q8'; select public.social_enable('2026-11-01'); select public.social_update_settings(false);
select public.social_follow(:'n1');
select is((select allow_mentions from public.social_profiles), true, 'mentions: allow_mentions defaults to on');
select public.social_update_settings(null, null, null, false);
select is((select allow_mentions from public.social_profiles), false, 'mentions: allow_mentions is set through social_update_settings');
reset role;
select invite_code as mgcode from public.groups where id = :'mg' \gset
set local role authenticated;
set local request.jwt.claims = :'q1'; select public.group_join_by_code(:'mgcode');
select public.social_follow(:'n3'); select public.social_follow(:'n4');
set local request.jwt.claims = :'q2'; select public.group_join_by_code(:'mgcode');
set local request.jwt.claims = :'q6'; select public.group_join_by_code(:'mgcode');
set local request.jwt.claims = :'q7'; select public.group_join_by_code(:'mgcode');
select public.social_block(:'n1');
set local request.jwt.claims = :'q1';
select public.social_block(:'n6');

-- Candidates (rules a-c per audience)
select is(array(select user_id from public.social_mention_candidates('', 'followers') order by user_id), array[:'n2', :'n3']::uuid[],
  'candidates: followers post -> my accepted followers only (moe, blocked, mentions-off excluded)');
select is(array(select user_id from public.social_mention_candidates('', 'friends') order by user_id), array[:'n3']::uuid[],
  'candidates: friends post -> mutual follows only');
select is(array(select user_id from public.social_mention_candidates('', 'public') order by user_id), array[:'n2', :'n3', :'n4']::uuid[],
  'candidates: public post -> follows in either direction (blocked and mentions-off excluded)');
select is(array(select user_id from public.social_mention_candidates('', 'group', :'mg') order by user_id), array[:'n2', :'n3']::uuid[],
  'candidates: group post -> active members only, blocked either way excluded');
select is(array(select user_id from public.social_mention_candidates('@İLK', 'public')), array[:'n3']::uuid[],
  'candidates: Turkish-safe prefix of a display-name word, leading @ ignored');
select is(array(select user_id from public.social_mention_candidates('MO', 'public')), array[:'n4']::uuid[],
  'candidates: case-insensitive username prefix (mona has mentions off)');
select ok((select count(*) from public.social_mention_candidates('', 'group')) = 0
          and (select count(*) from public.social_mention_candidates('', 'bogus')) = 0,
  'candidates: an invalid audience/group returns nothing');

-- Creating posts with mentions
select public.social_create_post('text', 'hi @max_m', null, 'followers', null, array[:'n2']::uuid[]) as mp_fol \gset
select throws_ok(format('select public.social_create_post(%L, %L, null, %L, null, %L::uuid[])', 'text', 'x', 'followers', array[:'n4']),
  'P0001', 'MENTION_NOT_ALLOWED', 'mentions: followers-only post refuses someone who does not follow me');
select throws_ok(format('select public.social_create_post(%L, %L, null, %L, null, %L::uuid[])', 'text', 'x', 'friends', array[:'n2']),
  'P0001', 'MENTION_NOT_ALLOWED', 'mentions: friends post refuses a one-way follower');
select public.social_create_post('text', 'friends @mel_m', null, 'friends', null, array[:'n3']::uuid[]) as mp_fr \gset
select public.social_create_post('text', 'public @moe_m', null, 'public', null, array[:'n4']::uuid[]) as mp_pub \gset
select throws_ok(format('select public.social_create_post(%L, %L, null, %L, null, %L::uuid[])', 'text', 'x', 'public', array[:'n5']),
  'P0001', 'MENTION_NOT_ALLOWED', 'mentions: a stranger cannot be tagged, even on a public post');
select throws_ok(format('select public.social_create_post(%L, %L, null, %L, %L, %L::uuid[])', 'text', 'x', 'group', :'mg', array[:'n6']),
  'P0001', 'MENTION_NOT_ALLOWED', 'mentions: someone I blocked cannot be tagged');
select throws_ok(format('select public.social_create_post(%L, %L, null, %L, %L, %L::uuid[])', 'text', 'x', 'group', :'mg', array[:'n7']),
  'P0001', 'MENTION_NOT_ALLOWED', 'mentions: someone who blocked me cannot be tagged');
select throws_ok(format('select public.social_create_post(%L, %L, null, %L, null, %L::uuid[])', 'text', 'x', 'followers', array[:'n8']),
  'P0001', 'MENTION_NOT_ALLOWED', 'mentions: a user with mentions off cannot be tagged');
select throws_ok(format('select public.social_create_post(%L, %L, null, %L, null, %L::uuid[])', 'text', 'x', 'public', array[:'n1']),
  'P0001', 'MENTION_NOT_ALLOWED', 'mentions: the author cannot tag themselves');
select throws_ok(format('select public.social_create_post(%L, %L, null, %L, %L, %L::uuid[])', 'text', 'x', 'group', :'mg', array[:'n4']),
  'P0001', 'MENTION_NOT_ALLOWED', 'mentions: a closed group post refuses non-members (even ones I follow)');
select public.social_create_post('text', 'crew @max_m', null, 'group', :'mg', array[:'n2', :'n2']::uuid[]) as mp_grp \gset
select throws_ok(format('select public.social_create_post(%L, %L, null, %L, null, %L::uuid[])', 'text', 'x', 'public',
                        (select array_agg(gen_random_uuid()) from generate_series(1, 11))),
  '22023', 'TOO_MANY_MENTIONS', 'mentions: at most 10 per post');
select throws_ok('select * from public.post_mentions', '42501', null, 'mentions: no direct select on post_mentions');
reset role;
select ok((select count(*) from public.post_mentions where post_id = :'mp_grp') = 1
          and (select count(*) from public.posts where author_id = :'n1') = 4,
  'mentions: duplicates collapse; refused posts are not created');
select is((select count(*)::int from public.social_notifications where user_id = :'n2' and kind = 'mention' and actor_id = :'n1'), 2,
  'mentions: each tag notifies the tagged user (kind mention)');

-- Post rows carry mentions
set local role authenticated;
set local request.jwt.claims = :'q2';
select is((select mentions from public.social_post(:'mp_fol')),
  jsonb_build_array(jsonb_build_object('user_id', :'n2', 'username', 'max_m', 'display_name', 'Max')),
  'mentions: post rows carry [{user_id, username, display_name}]');
select is((select mentions -> 0 ->> 'username' from public.social_feed() where id = :'mp_pub'), 'moe_m', 'mentions: feed rows carry mentions');
select is(array(select id from public.social_mentioned_posts() order by id),
  array(select unnest(array[:'mp_fol', :'mp_grp']::uuid[]) order by 1), 'mentioned posts: the posts I am tagged in');
select public.social_block(:'n4');
select is((select mentions from public.social_feed() where id = :'mp_pub'), '[]'::jsonb, 'mentions: a mention disappears for a viewer who blocked the tagged user');
set local request.jwt.claims = :'q3';
select is((select jsonb_array_length(mentions) from public.social_post(:'mp_pub')), 1, 'mentions: other viewers still see it');
select is(array(select id from public.social_mentioned_posts()), array[:'mp_fr']::uuid[], 'mentioned posts: only my own mentions');

-- Untag
select is(public.social_remove_mention(:'mp_fol'), false, 'untag: another user cannot remove someone else''s mention');
set local request.jwt.claims = :'q2';
select is(public.social_remove_mention(:'mp_fol'), true, 'untag: the tagged user removes themselves');
reset role;
select ok(not exists (select 1 from public.post_mentions where post_id = :'mp_fol')
          and not exists (select 1 from public.social_notifications where user_id = :'n2' and post_id = :'mp_fol' and kind = 'mention'),
  'untag: the mention and its notification are gone');
set local role authenticated;
set local request.jwt.claims = :'q2';
select is(array(select id from public.social_mentioned_posts()), array[:'mp_grp']::uuid[], 'mentioned posts: an untagged post disappears');
select public.group_leave(:'mg');
select is((select count(*)::int from public.social_mentioned_posts()), 0, 'mentioned posts: a post I can no longer view is not returned');

-- Blocks and audience changes
set local request.jwt.claims = :'q3';
select public.social_block(:'n1');
select is((select count(*)::int from public.social_mentioned_posts()), 0, 'mentioned posts: a blocked author''s posts are hidden');
reset role;
select is((select count(*)::int from public.post_mentions where post_id = :'mp_fr'), 0, 'mentions: a block removes the mentions between the two users');
set local role authenticated;
set local request.jwt.claims = :'q1';
select public.social_create_post('text', 'two tags', null, 'public', null, array[:'n2', :'n4']::uuid[]) as mp_two \gset
select public.social_set_audience(:'mp_two', 'followers');
reset role;
select is(array(select user_id from public.post_mentions where post_id = :'mp_two'), array[:'n2']::uuid[],
  'mentions: changing the audience drops mentions that no longer qualify');
insert into private.social_activity (user_id, kind, period_start, count) values (:'n1', 'mention', private.social_today(), 49)
on conflict (user_id, kind, period_start) do update set count = 49;
set local role authenticated;
set local request.jwt.claims = :'q1';
select throws_ok(format('select public.social_create_post(%L, %L, null, %L, null, %L::uuid[])', 'text', 'x', 'public', array[:'n2', :'n4']),
  'P0001', 'RATE_LIMITED', 'mentions: at most 50 mentions per author per day');

reset role;
select * from finish();
rollback;
