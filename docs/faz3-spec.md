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

- `push_subscriptions (id, user_id, endpoint unique, p256dh, auth, user_agent, created_at, last_used_at)`, RLS owner.
- VAPID keys: public key in `VITE_VAPID_PUBLIC_KEY`, private key only in Supabase Secrets (`VAPID_PRIVATE_KEY`).
- `pg_cron` every 5 minutes runs `public.dispatch_reminders()` (security definer, not granted to clients): it finds habits/todos whose `remind_at` falls in the last 5-minute window today (Istanbul) and are due and not yet done, and POSTs batches (subscription + short payload) to Edge Function `push-send` via `pg_net`, authenticated with a shared secret (`PUSH_DISPATCH_SECRET`). The function has no database access and no service_role; it only signs and sends Web Push.
- Payload: up to three habit/to-do names plus a count ("Kitap oku, Su iç +1"). Web Push payloads are end-to-end encrypted to the device (RFC 8291); the push service cannot read them.
- Notice update: device push endpoints and the browser push services (Apple, Google, Mozilla) are added to the KVKK notice; `legal.noticeVersion` is bumped.
