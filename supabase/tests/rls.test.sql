-- pgTAP suite (RLS, anti-IDOR, points, approval, workouts). Runs in CI before every deploy
-- (.github/workflows/ci.yml job "db-tests"); locally: npx supabase start && npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(91);

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
        'admin_set_registration_status', 'can_access', 'delete_my_account', 'finish_workout_session',
        'get_leaderboard', 'has_onboarded', 'is_admin', 'rls_auto_enable')),
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
values (:'s1', :'ub', 'strength', 'Push A', now() - interval '45 minutes');
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
select ok((select ended_at is not null and duration_sec between 2600 and 2800 from public.workout_sessions where id = :'s1'), 'finish: session closed with wall-clock duration');
select is((select points from public.point_events where user_id = :'ub' and ref_table = 'workout_sessions' and ref_id = :'s1'), 56, 'point_events: strength session row');
select is((select count(*)::int from public.point_events where user_id = :'ub' and ref_table = 'personal_records'), 0, 'no PR point event for a baseline');
select is((select total_points from public.profiles where user_id = :'ub'), 66, 'profile total = 10 + 56');
select is((select e1rm from public.personal_records where user_id = :'ub' and exercise_id = :'ex1'), 116.67::numeric, 'personal_records row stored');

-- s2: equal e1rm -> no PR --------------------------------------------------------
insert into public.workout_sessions (id, user_id, kind, started_at) values (:'s2', :'ub', 'strength', now() - interval '30 minutes');
insert into public.session_exercises (id, session_id, user_id, exercise_id, position) values (:'se2', :'s2', :'ub', :'ex1', 1);
insert into public.session_sets (session_exercise_id, session_id, user_id, set_no, weight_kg, reps) values (:'se2', :'s2', :'ub', 1, 100, 5);
insert into t_finish select 's2', public.finish_workout_session(:'s2');
select is((select jsonb_array_length(r->'new_prs') from t_finish where label = 's2'), 0, 'equal e1rm is not a PR');
select is((select (r->>'points_awarded')::int from t_finish where label = 's2'), 0, 'a single working set earns no session points (minimum 3)');
select is((select count(*)::int from public.personal_records where user_id = :'ub'), 1, 'still one PR row');

-- s3: higher e1rm -> PR, same day -> row upserted, no second PR points -------------
insert into public.workout_sessions (id, user_id, kind, started_at) values (:'s3', :'ub', 'strength', now() - interval '10 minutes');
insert into public.session_exercises (id, session_id, user_id, exercise_id, position) values (:'se3', :'s3', :'ub', :'ex1', 1);
insert into public.session_sets (session_exercise_id, session_id, user_id, set_no, weight_kg, reps) values (:'se3', :'s3', :'ub', 1, 110, 5);
insert into t_finish select 's3', public.finish_workout_session(:'s3');
select is((select jsonb_array_length(r->'new_prs') from t_finish where label = 's3'), 1, 'higher e1rm is a PR');
select is((select e1rm from public.personal_records where user_id = :'ub' and exercise_id = :'ex1'), 128.33::numeric, 'PR row updated to the new best');
select is((select count(*)::int from public.personal_records where user_id = :'ub'), 1, 'one PR row per exercise per day');
select is((select (r->>'points_awarded')::int from t_finish where label = 's3'), 20, 'real PR earns 20 (single set: no session points)');
select is((select total_points from public.profiles where user_id = :'ub'), 86, 'profile total after three sessions');

-- s4: cardio -------------------------------------------------------------------------
insert into public.workout_sessions (id, user_id, kind, started_at) values (:'s4', :'ub', 'cardio', now() - interval '5 minutes');
insert into public.cardio_entries (session_id, user_id, activity, duration_sec, distance_m) values (:'s4', :'ub', 'run', 1800, 5000);
insert into t_finish select 's4', public.finish_workout_session(:'s4');
select is((select (r->>'duration_sec')::int from t_finish where label = 's4'), 1800, 'cardio duration taken from cardio_entries');
select is((select (r->>'points_awarded')::int from t_finish where label = 's4'), 36, 'cardio: 30 + floor(1800/300)');
select is((select points from public.point_events where user_id = :'ub' and ref_table = 'personal_records' and ref_id = :'ex1' || ':' || (now() at time zone 'Europe/Istanbul')::date::text), 20, 'PR point event keyed exercise:local date');
-- clients cannot rewrite server-owned session columns or delete PRs
update public.workout_sessions set kind = 'cardio', ended_at = null, total_sets = 99 where id = :'s3';
select ok((select kind = 'strength' and ended_at is not null and total_sets = 1 from public.workout_sessions where id = :'s3'), 'client update of kind/ended_at/totals is ignored');
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
insert into public.workout_sessions (id, user_id, kind, started_at) values (:'s5', :'ub', 'strength', now() - interval '2 minutes');
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
  values ('00000000-0000-0000-0000-0000000000a6', :'ua', 'strength', now() - interval '20 minutes');
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
insert into public.workout_sessions (id, user_id, kind, started_at) values ('00000000-0000-0000-0000-0000000000a7', :'ua', 'cardio', now() - interval '5 minutes');
insert into public.cardio_entries (session_id, user_id, activity, duration_sec) values ('00000000-0000-0000-0000-0000000000a7', :'ua', 'run', 300);
select is((public.finish_workout_session('00000000-0000-0000-0000-0000000000a7')->>'points_awarded')::int, 0, 'cardio under 10 minutes earns no points');

select * from finish();
rollback;
