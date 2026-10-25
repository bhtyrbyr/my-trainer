-- pgTAP suite (RLS, anti-IDOR, points, approval, workouts). Runs in CI before every deploy
-- (.github/workflows/ci.yml job "db-tests"); locally: npx supabase start && npx supabase test db
begin;
-- The app's calendar day is Europe/Istanbul (points, streaks, weeks): test in the same zone so the
-- suite does not depend on the hour it runs (UTC and Istanbul dates differ 21:00-24:00 UTC).
set local timezone = 'Europe/Istanbul';
create extension if not exists pgtap with schema extensions;
select plan(175);

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
      and p.proname not in ('rls_auto_enable')),
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
        'get_leaderboard', 'has_onboarded', 'is_admin', 'progress_photo_object_count', 'rls_auto_enable')),
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
insert into public.exercises (id, external_id, source, name_en, is_custom, user_id, gif_path)
values (:'ex3', 'fake-ext', 'exercisedb', 'My Cable Curl', false, :'ub', 'gifs/0001.gif');
select is(
  (select is_custom::text || ':' || source || ':' || coalesce(external_id, 'null') || ':' || coalesce(gif_path, 'null') || ':' || user_id::text
     from public.exercises where id = :'ex3'),
  'true:custom:null:null:00000000-0000-0000-0000-00000000000b',
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

select * from finish();
rollback;
