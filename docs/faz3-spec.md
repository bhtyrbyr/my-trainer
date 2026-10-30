# Faz 3 technical spec: habits + to-dos (+ reminders)

Source of truth for Faz 3. Keep names exactly as written; frontend types derive from this.
Product rules: `docs/PRD.md` M5, M6, section 1.4 (points: habit_done 10, max 50/day; todo_done 5, max 30/day).
User decisions (2026-10-30): habits are yes/no **with an optional daily target count**; overdue one-off to-dos **carry over to today**; **push reminders** are in scope (step 4, last).

## 1. Recurrence rule (shared by habits and recurring to-dos)

`rule jsonb`, one of:

```jsonc
{ "type": "daily" }
{ "type": "weekly", "days": [1, 3, 5] }   // ISO weekday 1 = Monday ... 7 = Sunday; 1-7 distinct values
{ "type": "weekly_count", "n": 3 }        // habits only: any n days per ISO week (Mon-Sun); n 1..7
{ "type": "monthly", "day": 15 }          // 1..31, clamped to the month's last day (31 -> Feb 28/29)
{ "type": "every", "n": 2 }               // every n days counted from starts_on; n 2..365
```

- An occurrence exists on day `d` only when `d >= starts_on` (and, for habits, `archived_at` is null or later than d).
- `weekly_count`: the habit is shown on every day of the week until `n` days of that week are done; done days stay shown as done.
- Twins that must agree: SQL `public.recurrence_matches(p_rule jsonb, p_starts_on date, p_day date) returns boolean` (immutable, used by reminders) and TS `src/lib/recurrence.ts` `matches(rule, startsOn, day)`. Both are tested with the same vectors (`src/lib/recurrence.vectors.json`).
- SQL `public.recurrence_valid(p_rule jsonb, p_allow_weekly_count boolean) returns boolean` backs the check constraints.

## 2. Tables (all RLS: `user_id = auth.uid() and public.can_access()`)

```sql
habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  emoji text check (emoji is null or char_length(emoji) <= 8),
  rule jsonb not null default '{"type":"daily"}',         -- recurrence_valid(rule, true)
  target_count integer not null default 1 check (target_count between 1 and 999),
  unit text check (unit is null or char_length(unit) <= 16),   -- e.g. 'sayfa', 'bardak'; null for yes/no
  starts_on date not null default current_date,           -- Istanbul day
  remind_at time,                                          -- local time (Europe/Istanbul), null = no reminder
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  day date not null,
  count integer not null default 1 check (count between 1 and 9999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (habit_id, day)
)
todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  note text check (note is null or char_length(note) <= 1000),
  priority smallint not null default 0 check (priority between 0 and 2),   -- 0 normal, 1 high, 2 urgent
  due_on date,                 -- one-off: optional due day (null = someday); recurring: null
  rule jsonb,                  -- null = one-off; else recurrence_valid(rule, false)
  starts_on date not null default current_date,
  remind_at time,              -- reminder on the due day / each occurrence (needs due_on or rule)
  archived_at timestamptz,     -- recurring: stopped; one-off: deleted softly is NOT used (hard delete)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
todo_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  todo_id uuid not null references public.todos(id) on delete cascade,
  day date not null,           -- the occurrence: one-off = coalesce(due_on, completion day); recurring = occurrence day
  completed_on date not null default current_date,   -- Istanbul day it was ticked (points use this)
  created_at timestamptz not null default now(),
  unique (todo_id, day)
)
```

Guards (triggers, `set timezone = 'Europe/Istanbul'`):
- `habit_logs` / `todo_completions`: the parent row must belong to the same `user_id` (else `FORBIDDEN`, 42501) — a guessed foreign id cannot be logged against. `day` not in the future (`FUTURE_DATE`). `user_id`, `habit_id`/`todo_id`, `day` immutable on update.
- One-off todo: at most one completion. Recurring todo: `day` must be an occurrence (`recurrence_matches`), else `NOT_DUE`.
- Limits (anti-abuse, `LIMIT_REACHED`): 50 non-archived habits, 500 todos per user.
- `remind_at` on a todo requires `due_on` or `rule` (check constraint).

## 3. Points (DB triggers only; rule 2)

- `habit_done`: a habit day is complete when `habit_logs.count >= habits.target_count`. Award on reaching it, revoke when an update drops below or the log is deleted. `award_points(user, 'habit_done', log.day, 'habit_logs', habit_id || ':' || day)`. Changing `target_count` does not re-score past days.
- `todo_done`: on completion insert `award_points(user, 'todo_done', completed_on, 'todo_completions', todo_id || ':' || day)`; revoke on delete (un-tick).
- Caps come from `point_rules` (already seeded). Deleting a habit/todo cascades to logs/completions, whose delete triggers revoke points.

## 4. Client

- `src/lib/recurrence.ts`: `matches`, `occurrencesBetween(rule, startsOn, from, to)`, `weekCount` helpers; habit `streak(logs, habit, today)` = consecutive due days completed, counting back from today (today not yet done does not break it); `weekly_count` streak = consecutive completed weeks.
- Track day view gets a **"Bugün" list** (habits due that day + to-dos due that day; on today also overdue one-off to-dos, labelled). Tick = one tap; counter habits: +1 tap and a stepper.
- `/track/habits`: list with streak and a 5-week heatmap per habit; add/edit sheet (name, emoji, schedule, target + unit, reminder time, archive/delete).
- `/track/todos`: groups Overdue, Today, Upcoming, Someday, Recurring, Done (last 30 days); add/edit sheet.
- i18n namespace `today` (TR + EN).

## 5. Reminders (step 4)

Free-tier Web Push. Works on Android/desktop browsers and on iPhone only when the app is added to the Home Screen (iOS 16.4+).

**Database** (migration `20261102010000_push_reminders.sql`):
- Extensions: `pg_net` (schema `extensions`) and `pg_cron`.
- `push_subscriptions (id uuid pk, user_id uuid not null -> auth.users on delete cascade, endpoint text unique not null (https, <= 1000 chars), p256dh text not null (<= 200), auth text not null (<= 100), user_agent text (<= 300), created_at, last_used_at)`. RLS owner select/delete only; writes through RPCs.
- `register_push(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)` (definer, granted to authenticated): removes any row with that endpoint (a device that switched accounts) and inserts it for the caller; at most 10 subscriptions per user (oldest dropped).
- `unregister_push(p_endpoint text)` (definer, authenticated): deletes the caller's row for that endpoint.
- Private schema `private` (no grants to anon/authenticated): `private.push_config (id boolean pk default true check (id), function_url text, secret text)`, `private.reminder_log (user_id uuid, ref text, day date, sent_at timestamptz default now(), primary key (user_id, ref, day))`.
- `set_push_config(p_url text, p_secret text)` (definer) granted to `service_role` only (deploy workflow calls it).
- `prune_push_subscriptions(p_secret text, p_endpoints text[])` (definer, granted to anon and authenticated, because the Edge Function calls it with the anon key): if `p_secret` equals the stored secret, deletes those endpoints (410/404 from the push service); otherwise raises FORBIDDEN. Add it to the pgTAP allow-list with this reason.
- `dispatch_reminders()` (definer, never granted to clients): runs as cron every 5 minutes. Local time = `now() at time zone 'Europe/Istanbul'`. Due reminders = rows whose `remind_at` is in `[local_time - 5 min, local_time]` today (no wrap across midnight), that are due today (`recurrence_matches`; habits active, weekly_count week quota still open; recurring todos not archived; one-off todos with `due_on = today`) and not done today (habit count < target; no todo completion for today's occurrence / for the one-off). Each (user, 'habit:<id>' | 'todo:<id>', day) is sent once (insert into reminder_log on conflict do nothing). Group per user: payload `{"body": "<up to 3 names joined by ', '>[ +N]", "url": "/track", "tag": "reminders-<day>"}`; one `net.http_post` per batch of up to 100 messages to `push_config.function_url` with header `x-dispatch-secret`, body `{"messages": [{"endpoint", "p256dh", "auth", "payload"}...]}`. Does nothing when push_config is missing.
- `select cron.schedule('push-reminders', '*/5 * * * *', 'select public.dispatch_reminders()')` (idempotent: unschedule first if it exists).

**Edge Function** `supabase/functions/push-send` (`verify_jwt = false` in config.toml; auth = constant-time compare of `x-dispatch-secret` with `PUSH_DISPATCH_SECRET`). No service_role, no database reads: it encrypts each payload (RFC 8291 aes128gcm, WebCrypto) and signs a VAPID JWT (ES256, `VAPID_SUBJECT`), POSTs to the endpoint with TTL 3600 and Urgency normal, then reports 404/410 endpoints back through `prune_push_subscriptions` using the anon key.

**Secrets** (the user only creates three GitHub secrets; deploy.yml does the rest): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (from `npx web-push generate-vapid-keys`), `PUSH_DISPATCH_SECRET` (random). deploy.yml sets them as Supabase function secrets, calls `set_push_config` with the service role, and builds the app with `VITE_VAPID_PUBLIC_KEY`. Without them the feature stays hidden.

**Client**: the service worker imports `/push-sw.js` (push + notificationclick; title = the manifest name, so a rename needs no change). Settings > Notifications turns reminders on for this device (permission on a user gesture, subscribe, `register_push`); on iPhone outside the Home Screen it explains how to install first. Habit and to-do sheets get an optional reminder time.

**KVKK**: the notice adds the device push address and the browser push services (Apple, Google, Mozilla); `legal.noticeVersion` is bumped.
