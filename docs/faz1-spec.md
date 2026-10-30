> Note (2026-10-30): the ExerciseDB parts of this spec are superseded by docs/catalog-v2-spec.md; ExerciseDB was removed.

# Faz 1 technical spec: workouts + exercise catalog + leaderboard UI

Source of truth for all Faz 1 agents. Keep column names exactly as written; the frontend types are derived from this.
Product rules: `docs/PRD.md` M1, M12, section 1.4 (points), section 2.2 (catalog), section 3 (data model).

## 1. Catalog tables (shared, read-only for users)

```sql
muscles (
  wger_id integer primary key,
  name_latin text not null,
  name_en text not null,
  name_tr text,
  is_front boolean not null,
  svg_main_path text,          -- storage path in exercise-media, e.g. muscles/main/1.svg
  svg_secondary_path text
)
muscle_aliases (
  exercisedb_name text primary key,   -- e.g. 'pectorals'
  wger_id integer references muscles(wger_id)
)
exercises (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,            -- ExerciseDB exerciseId, null for custom
  source text not null default 'exercisedb' check (source in ('exercisedb','custom')),
  name_en text not null,
  name_tr text,
  body_parts text[] not null default '{}',
  target_muscles text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  equipment text[] not null default '{}',
  instructions_en text[] not null default '{}',
  instructions_tr text[],
  gif_path text,                      -- storage path in exercise-media, e.g. gifs/<external_id>.gif
  is_custom boolean not null default false,
  user_id uuid references auth.users(id) on delete cascade,   -- only for custom
  search tsvector generated always as (to_tsvector('simple', coalesce(name_en,'') || ' ' || coalesce(name_tr,''))) stored,
  created_at, updated_at
)
exercise_catalog_meta (source text primary key, item_count integer, synced_at timestamptz, license_text text)
```
RLS: catalog rows (`is_custom = false`) select to authenticated when `can_access()`; custom rows full CRUD when `user_id = auth.uid() and can_access()`; insert of custom rows forces `is_custom = true, source = 'custom', external_id = null` via trigger. Writes to catalog rows only by service_role (no policy).
Indexes: GIN on `search`, GIN on `target_muscles`, btree on `(is_custom, user_id)`.

Storage bucket `exercise-media` (private): select to authenticated when `can_access()`; insert/update/delete: nobody via policies (service_role bypasses).
Frontend reads GIF/SVG via `supabase.storage.from('exercise-media').createSignedUrl(path, 3600)` cached in TanStack Query (or `getPublicUrl` if bucket made public later).

## 2. Workout tables (per user, RLS owner-only via `user_id = auth.uid() and can_access()`)

```sql
workout_templates (id, user_id, name text not null, notes text, color text, sort_order int default 0, archived boolean default false, created_at, updated_at)
template_exercises (id, template_id uuid references workout_templates on delete cascade, user_id, exercise_id uuid references exercises, position int not null, target_sets int default 3, target_reps_low int default 8, target_reps_high int default 12, rest_seconds int default 90, notes text)
workout_sessions (id, user_id, template_id uuid null references workout_templates on delete set null, kind text not null check (kind in ('strength','cardio')), title text, started_at timestamptz not null default now(), ended_at timestamptz, duration_sec int, notes text, total_volume_kg numeric(10,1) default 0, total_sets int default 0, created_at, updated_at)
session_exercises (id, session_id uuid references workout_sessions on delete cascade, user_id, exercise_id uuid references exercises, position int not null, notes text)
session_sets (id, session_exercise_id uuid references session_exercises on delete cascade, session_id uuid references workout_sessions on delete cascade, user_id, set_no int not null, weight_kg numeric(6,2), reps int, rpe numeric(3,1), is_warmup boolean default false, completed_at timestamptz default now())
cardio_entries (id, session_id uuid references workout_sessions on delete cascade, user_id, activity text not null check (activity in ('run','walk','bike','row','swim','hiit','other')), duration_sec int not null, distance_m int, avg_hr int, notes text)
personal_records (id, user_id, exercise_id, session_set_id uuid references session_sets on delete cascade, weight_kg numeric(6,2), reps int, e1rm numeric(7,2) not null, achieved_on date not null, created_at)
```
Index every table on `(user_id, <date>)`: sessions `(user_id, started_at desc)`, sets `(user_id, completed_at)`, PRs `(user_id, exercise_id, e1rm desc)`.

## 3. Server logic (triggers / functions)

- `e1rm(weight, reps) = weight * (1 + reps/30.0)` (Epley), reps >= 1, warmups excluded.
- `finish_workout_session(p_session uuid)` RPC (security invoker; RLS applies): sets `ended_at = now()`, `duration_sec`, recomputes `total_volume_kg = sum(weight*reps)` and `total_sets` over non-warmup sets, then:
  - awards `workout_strength` points: `50 + 2 * total_sets` via `award_points(user, 'workout_strength', ended_at::date, 'workout_sessions', id::text, 50 + 2*total_sets)` (rule caps at 100) — only for kind = 'strength' with total_sets >= 1;
  - for kind = 'cardio': `30 + duration_min/5` via `award_points(..., 'workout_cardio', ..., 30 + floor(duration_sec/300))`;
  - PR detection: for each exercise in the session, best non-warmup set by e1rm; if greater than the user's previous best e1rm for that exercise (from `personal_records`) insert a `personal_records` row and `award_points(user, 'personal_record', date, 'personal_records', pr_id::text)` (unique per exercise per day enforced by ref = exercise_id||date).
  Returns a json summary `{duration_sec, total_sets, total_volume_kg, points_awarded, new_prs: [{exercise_id, e1rm, weight_kg, reps}]}`.
- `after delete` trigger on `workout_sessions` -> `revoke_points(user_id, 'workout_sessions', id::text)` (PR rows cascade via session_set FK; also revoke their points: trigger on `personal_records` after delete -> `revoke_points(user_id, 'personal_records', id::text)`).
- `last_sets_for_exercise(p_exercise uuid, p_limit int default 1)` RPC: returns the previous session's sets for that exercise (for "what did I do last time").
- `exercise_progress(p_exercise uuid)` RPC: per-session best e1rm and total volume over time (for the trend chart).

## 4. Points integration
`award_points`/`revoke_points` are security definer and executable only by service_role; triggers and the `finish_workout_session` function run as the function owner (postgres), so they can call them. Mark `finish_workout_session` as `security definer` BUT verify ownership: first line `if not exists (select 1 from workout_sessions where id = p_session and user_id = auth.uid()) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;`.

## 5. Sync script contract (`scripts/sync-exercises.mjs`)
- Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (never committed; GitHub secret / local `.env.sync.local`).
- ExerciseDB: `GET https://oss.exercisedb.dev/api/v1/exercises?limit=100&cursor=…` until `meta.hasNextPage = false`. Upsert `exercises` by `external_id` with fields above. Download `gifUrl`, upload to `exercise-media/gifs/<exerciseId>.gif` (skip if exists, content-type image/gif, upsert true).
- wger: `GET https://wger.de/api/v2/muscle/?limit=50` -> upsert `muscles` (wger_id, name_latin = name, name_en, is_front, svg paths); download `image_url_main` / `image_url_secondary` to `exercise-media/muscles/main/<id>.svg` and `.../secondary/<id>.svg`. Also download the body silhouettes `https://wger.de/static/images/muscles/muscular_system_front.svg` and `_back.svg` to `exercise-media/muscles/front.svg` / `back.svg` (fall back gracefully if 404).
- `muscle_aliases`: upsert from the mapping in `scripts/muscle-aliases.json` (ExerciseDB name -> wger id).
- `exercise_catalog_meta`: upsert rows for 'exercisedb' and 'wger' with counts, synced_at, license text.
- Idempotent, resumable, rate-friendly (concurrency 4, retry 3 with backoff), logs a summary. Exit non-zero on failure.
- `name_tr` seed: `scripts/exercise-names-tr.json` (external_id -> Turkish name) applied after upsert, never overwriting a non-null `name_tr` that differs (users may edit later).

## 5b. Day-based plans (added 2026-10-26, migration 20261026030000_day_plans.sql)
- `workout_templates.weekdays smallint[]` (ISO 1 = Monday ... 7 = Sunday), GIN indexed. A template = "my Monday workout"; one template may cover several days.
- `todays_templates(p_isodow int default null)` RPC: caller's non-archived templates planned for that weekday (default today).
- `exercise_progress(p_exercise)` now also returns `avg_weight_kg` (average working weight, warmups excluded) and `best_reps`.

## 6. Frontend scope (after schema + types)
- Types: regenerate `src/lib/database.types.ts` with `npx supabase gen types typescript --linked`.
- `features/exercises`: library page (search, filters: body part, target muscle, equipment; infinite list), detail sheet (GIF, muscle diagram front/back with target/secondary overlays, instructions TR/EN), "add custom exercise".
- `features/workouts`: templates (CRUD, reorder), guided session flow (`/workouts/session/:id`): one exercise at a time, previous sets, set input (kg/reps/RPE, steppers), finish set -> rest timer (countdown, +30s, skip, vibration via `navigator.vibrate`, audio beep), next exercise, finish -> summary with points + PRs; draft persisted in localStorage keyed by session id; cardio quick-log; history (calendar + list), exercise trend chart (Recharts).
- `features/leaderboard`: segmented week/month/all, rows from `get_leaderboard`, own row pinned if outside top 50.
- Points triggers also feed `profiles.total_points`; `HeaderActions` already shows level.
