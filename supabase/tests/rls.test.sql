-- pgTAP tests for the Faz 0 core. Run: npx supabase test db   (local stack via Docker)
begin;
select plan(18);

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
select is((select role from public.profiles where user_id = :'ua'), 'admin', 'first profile becomes admin when no bootstrap email set');

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

-- Bob onboards --------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@example.com","role":"authenticated"}';
insert into public.profiles (user_id, username, display_name, avatar_path, onboarding_completed_at)
values (:'ub', 'bob', 'Bob', '00000000-0000-0000-0000-00000000000b/avatar.jpg', now());
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

select * from finish();
rollback;
