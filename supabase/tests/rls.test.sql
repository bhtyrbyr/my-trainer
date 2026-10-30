-- pgTAP suite (RLS, anti-IDOR, points, approval, workouts). Runs in CI before every deploy
-- (.github/workflows/ci.yml job "db-tests"); locally: npx supabase start && npx supabase test db
begin;
-- The app's calendar day is Europe/Istanbul (points, streaks, weeks): test in the same zone so the
-- suite does not depend on the hour it runs (UTC and Istanbul dates differ 21:00-24:00 UTC).
set local timezone = 'Europe/Istanbul';
create extension if not exists pgtap with schema extensions;
select plan(308);

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
        'get_leaderboard', 'has_health_consent', 'has_onboarded', 'is_admin', 'progress_photo_object_count', 'prune_push_subscriptions', 'record_consent',
        'register_push', 'rls_auto_enable', 'unregister_push', 'withdraw_health_consent')),
  '{}'::text[],
  'authenticated can execute only the allow-listed security-definer RPCs'
);

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
select throws_ok(
  $$ insert into public.profile_private (user_id, height_cm) values ('00000000-0000-0000-0000-00000000000b', 180) $$,
  '42501', null, 'pending bob cannot write other tables'
);
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
insert into public.profile_private (user_id, height_cm) values (:'ub', 180);

-- 8. bob cannot escalate himself
update public.profiles set role = 'admin', is_blocked = false, total_points = 500 where user_id = :'ub';
select is((select role || ':' || total_points from public.profiles where user_id = :'ub'), 'user:0', 'bob cannot change role or points');

-- 9-10. isolation: bob sees alice's PUBLIC profile but not her private rows / settings
select is((select count(*)::int from public.profiles), 2, 'public profiles visible to all users');
select is((select count(*)::int from public.user_settings where user_id = :'ua'), 0, 'bob cannot read alice settings');

-- IDOR attempts: bob tampers with user_id in filters / bodies ------------------
select is((select count(*)::int from public.profile_private where user_id = :'ua'), 0, 'IDOR read: bob gets zero private rows for alice');
select throws_ok(
  $$ insert into public.user_settings (user_id, locale) values ('00000000-0000-0000-0000-00000000000a', 'en') $$,
  '42501', null, 'IDOR write: bob cannot insert a row owned by alice'
);
update public.profiles set display_name = 'HACKED' where user_id = :'ua';
select is((select display_name from public.profiles where user_id = :'ua'), 'Alice', 'IDOR update: bob cannot change alice profile');
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
select is((public.ai_reserve() ->> 'user_left')::int, 39, 'ai: a request is counted against the daily limit');
select throws_ok(
  $$ insert into public.ai_usage (user_id, day, request_count) values ('00000000-0000-0000-0000-00000000000b', current_date, 0) $$,
  '42501', null, 'ai: clients cannot write the usage counter'
);
update public.user_settings set ai_daily_limit = 1000 where user_id = :'ub';
select is((select ai_daily_limit from public.user_settings where user_id = :'ub'), 40, 'ai: users cannot raise their own AI limit');
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
  format('select public.register_push(%L, %L, %L, null)', 'https://push.example.com/' || repeat('x', 1000), 'abc', 'def'),
  '22023', 'BAD_ENDPOINT', 'push: endpoints over 1000 characters are rejected'
);
select throws_ok(
  $$ select public.register_push('https://push.example.com/k', repeat('k', 201), 'def', null) $$,
  '22023', 'BAD_KEY', 'push: oversized keys are rejected'
);
select throws_ok(
  $$ insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('00000000-0000-0000-0000-00000000000a', 'https://push.example.com/direct', 'k', 'a') $$,
  '42501', null, 'push: clients cannot insert subscriptions directly'
);
select throws_ok(
  $$ update public.push_subscriptions set p256dh = 'x' $$,
  '42501', null, 'push: clients cannot update subscriptions'
);
select lives_ok(
  $$ select public.register_push('https://push.example.com/alice-' || lpad(g::text, 2, '0'), 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg', null)
       from generate_series(1, 11) g $$,
  'push: alice registers 11 more devices'
);
select ok(
  (select count(*) = 10 from public.push_subscriptions)
  and not exists (select 1 from public.push_subscriptions where endpoint in (:'pe1', 'https://push.example.com/alice-01'))
  and exists (select 1 from public.push_subscriptions where endpoint = 'https://push.example.com/alice-11'),
  'push: at most 10 devices per user, the oldest are dropped'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
select public.register_push('https://push.example.com/alice-11', :'pk', :'pa', null);
select is(
  (select array_agg(endpoint) from public.push_subscriptions), array['https://push.example.com/alice-11'],
  'push: re-registering an endpoint from another account moves it there (bob sees only his device)'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@example.com","role":"authenticated"}';
select ok(
  (select count(*) = 9 from public.push_subscriptions)
  and not exists (select 1 from public.push_subscriptions where user_id = :'ub' or endpoint = 'https://push.example.com/alice-11'),
  'push IDOR: alice sees only her own devices, not the one that moved to bob'
);
select public.unregister_push('https://push.example.com/alice-11');
delete from public.push_subscriptions where endpoint = 'https://push.example.com/alice-11';
select public.unregister_push('https://push.example.com/alice-10');
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
  $$ select public.prune_push_subscriptions('anything', array['https://push.example.com/alice-09']) $$,
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
  $$ select public.prune_push_subscriptions('wrong-secret-wrong-secret-wrong-secret', array['https://push.example.com/alice-09']) $$,
  '42501', 'FORBIDDEN', 'push: prune with a wrong secret is refused'
);
select is(
  public.prune_push_subscriptions(:'psecret', array['https://push.example.com/alice-09', 'https://push.example.com/unknown']), 1,
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
    'endpoint', 'https://push.example.com/alice-11', 'p256dh', :'pk', 'auth', :'pa',
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
  (select last_used_at is not null from public.push_subscriptions where endpoint = 'https://push.example.com/alice-11'),
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
delete from public.push_subscriptions where endpoint = 'https://push.example.com/alice-11';
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

select * from finish();
rollback;
