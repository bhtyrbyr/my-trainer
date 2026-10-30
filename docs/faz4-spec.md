# Faz 4 technical spec: dashboard, badges, admin, units, offline, AI coach

Product: docs/PRD.md M7, M8, M10, M12 (badges), M13. Decisions (2026-10-31): keep the plan order; AI coach is in Faz 4 (quota-limited, after the AI safeguards); units are a user option (kg/lb, cm/in). Names are binding.

## 1. Database (one migration per area, numbered 20261106*)

**Badges** (`20261106000000_badges.sql`)
- `badges (code text pk, sort integer, threshold integer)`: seeded `first_workout` (1 finished strength or cardio session), `streak_7` (current streak reached 7), `streak_30`, `sets_100` (100 finished working sets, warm-ups excluded), `photos_10` (10 progress photos), `habit_30` (30 completed habit days), `todo_50` (50 completed to-dos). Names/descriptions live in i18n, not the table.
- `user_badges (user_id, badge_code -> badges, earned_at timestamptz default now(), primary key (user_id, badge_code))`. RLS: owner read; no client writes. Public view: `get_user_badges(p_user uuid)` (security definer, authenticated) returns the codes and dates of ANY approved, non-blocked user who is on the leaderboard (`show_on_leaderboard`) or the caller; nothing else.
- Awarding: `public.check_badges(p_user uuid)` (definer, internal, idempotent `insert ... on conflict do nothing`), called at the end of the existing points triggers path (after `award_points` writes) or from the relevant insert triggers; never revoked when the source is later deleted (badges are milestones). Badges give no points.

**Admin** (`20261106010000_admin_panel.sql`)
- `admin_set_config(p_key text, p_value jsonb)` (definer, admin only): allowed keys `access_mode` ("open" | "invite"), `require_approval` (bool), `ai_global_daily_limit` (int 0..10000), `ai_default_daily_limit`? (no: per-user limit stays in user_settings). Rejects anything else.
- `admin_list_allowed_emails()`, `admin_add_allowed_email(p_email text, p_note text)`, `admin_remove_allowed_email(p_email text)` (admin only, lowercase, simple email check).
- `admin_list_users(p_query text, p_limit int)` (admin only): user_id, username, display_name, email, status, role, is_blocked, created_at, last_active_on, ai_daily_limit.
- `admin_set_blocked(p_user uuid, p_blocked boolean)`, `admin_set_ai_limit(p_user uuid, p_limit int 0..1000)` (admin only; an admin cannot block themself or another admin).
- All raise `FORBIDDEN` for non-admins; granted to authenticated; pgTAP covers non-admin refusal.

**Dashboard** (`20261106020000_dashboard.sql`)
- `get_week_summary(p_week_start date)` (definer? no: invoker + RLS; plain SQL function over the caller's rows, granted to authenticated) returns jsonb: `{ workouts, sets, volume_kg, cardio_minutes, habit_rate (0..1 over due habit-days), todos_done, avg_sleep_minutes, weight_change_kg (last weigh-in of the week minus last before it, null if missing), water_goal_days }`. Health parts are null without health consent (RLS already hides those rows).

**AI coach** (`20261106030000_ai_coach.sql`)
- `ai_conversations (id, user_id, title, created_at, updated_at)`, `ai_messages (id, conversation_id -> cascade, user_id, role check in ('user','assistant'), content text <= 4000, created_at)`; RLS owner; client inserts only role 'user' rows (assistant rows are written by the Edge Function with the caller's token through `ai_add_assistant_message(conversation, content)` definer that checks ownership).
- `ai_log_usage` already accepts `coach_chat`.
- Coach context = `get_coach_context()` (invoker): last 28 days aggregates (workouts, volume by body part, PRs, habits rate, to-dos done; weight/sleep/nutrition only with health consent). Never photos, never names/emails.

## 2. Units (user option)
- `user_settings.unit_weight` ('kg' | 'lb'), `unit_length` ('cm' | 'in') already exist. Storage stays metric everywhere.
- `src/lib/units.ts`: `kgToDisplay`, `displayToKg`, `cmToDisplay`, `displayToCm`, formatting helpers with unit labels via i18n; 1 lb = 0.45359237 kg, 1 in = 2.54 cm; display rounding (kg/lb 0.5 step for sets? no: show 1 decimal max, inputs accept decimals).
- `useUnits()` hook reads user_settings; Settings gets a Units section (two segmented controls).
- Apply to every weight/length shown or entered: workout sets and history, exercise progress charts, PRs, body (weight, target, measurements, BMI stays metric internally), photo meta weight, dashboard. Kcal, ml, minutes unchanged.

## 3. Dashboard (Home)
- Today: today's workout card (exists), energy card (exists), water progress, last night's sleep, today's habits/to-dos count with a link to Track, AI weekly review card (after section 6).
- This week: `get_week_summary` tiles (design-director: no four identical cards; one strong number + supporting row).
- Rule-based suggestions (pure client logic, tested): e.g. muscle group not trained for ≥ 4 days, water below 40% after 18:00, no weigh-in for 7 days (with health consent), streak at risk (no points today after 20:00), habit due but undone. At most 2 shown, dismissible for the day (localStorage).
- New badge celebration toast/sheet when `user_badges` gains a row.

## 4. Badges UI
- Profile: badge shelf (earned in colour, locked muted with progress text). Leaderboard row tap -> public profile sheet with badges (via `get_user_badges`).

## 5. Admin panel (Profile > Admin)
- Pages: Access (mode, approval switch, allowed e-mail list), Users (search, block/unblock, per-user AI limit), existing Requests, AI usage (+ global limit editor), Error reports.

## 6. Offline queue
- Persist TanStack Query cache (IndexedDB, excluding photo/vault/private-key queries and anything health-gated? no: health rows are the user's own and may persist, but never photo data or blobs).
- Queue for offline writes on the gym-critical paths: session sets (add/update/delete), finish session, water add, habit tick, to-do tick. Replay in order on reconnect; conflicts surface via ErrorNote with "retry/discard". Show an offline banner.

## 7. AI coach
- Edge Function action `coach-chat` in ai-coach: gate `ai_reserve()` (consent + age + quota), context from `get_coach_context()`, Flash Lite preferred (Flash quota is tiny), response <= 600 tokens, stored via `ai_add_assistant_message`.
- UI: Profile > AI coach (conversation list + chat), quick prompts ("Bu hafta nasıl gittim?", "Yarın ne çalışayım?"), weekly review card on Home generated on demand (one tap, not automatic, to save quota).
