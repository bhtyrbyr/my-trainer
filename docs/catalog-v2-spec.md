# Exercise catalog v2: openly licensed replacement for ExerciseDB

Why: ExerciseDB's terms forbid caching/redistribution and the GIF provenance is disputed (docs/LICENSING.md). Source of truth for the three work streams below. Names are binding.

## Sources (pinned)

- **wger** exercise API (`https://wger.de/api/v2/exerciseinfo/?limit=100&offset=N`): text, muscles, equipment, category; per-entry `license` (CC-BY-SA 3/4, CC0) and `license_author`. Images are NOT used except an allow-list (author/derivative source contains "everkinetic", or `is_ai_generated`, or Wikimedia), never the red-flag ones (Men's Health, fitnessvolt, workoutguru, liftmanual, lyfta, training.fit, docteur-fitness, gymnasticbodies, Athlean-X).
- **workout-guide** (`github.com/bryllim/workout-guide`, pinned to one commit recorded in the script): 302 exercises x 3 SVG frames, CC BY-SA 4.0 (76 traced from Everkinetic, rest by Bryl Lim); metadata MIT.
- Muscle diagrams already in use: wger / Termininja, CC BY-SA 3.0.

## Selection (~650)

wger entries with an English translation, description > 40 chars and at least one muscle; drop names that are not English, test/junk entries and near-duplicates within a `variation_group` (keep the best-described one). Add workout-guide exercises that wger lacks (name + muscles + equipment from its MIT manifest; instructions empty until written). All core lifts must be present (squat, bench, deadlift, OHP, rows, pull/chin-ups, lunges, dips, hip thrust, leg press, curls, triceps, lateral raise, plank, push-ups, cable/machine basics, running/cycling/rowing).

## Schema changes (migration `20261103000000_catalog_v2.sql`)

```sql
alter table public.exercises
  add column media_frames text[] not null default '{}',   -- storage paths in exercise-media: frames/<slug>/<n>.svg, played in order
  add column attribution jsonb;  -- { text: {author, license, url}, media: {author, license, url}, changes: text[] }
-- source check: ('exercisedb','custom') -> ('exercisedb','wger','workout-guide','legacy','custom')
```
- `external_id`: `wger:<exercise uuid>` or `wg:<workout-guide slug>`.
- Vocabulary is unchanged: `body_parts`, `target_muscles`, `secondary_muscles`, `equipment` keep the existing ExerciseDB-style terms used by `src/features/exercises/vocab.ts` and `scripts/muscle-aliases.json`; the sync maps wger/workout-guide values onto them.
- `public.replace_catalog_exercise(p_old uuid, p_new uuid)` (security definer, granted to service_role only): repoints `template_exercises`, `session_exercises`, `session_sets` (and any other FK to exercises) from old to new, then deletes the old row.
- `public.retire_catalog_exercise(p_id uuid)` (service_role only): when referenced, sets `source = 'legacy'`, clears `gif_path`, `instructions_en`, `instructions_tr`, `media_frames`; when not referenced, deletes it.
- Library and pickers show only `source in ('wger','workout-guide','custom')`; legacy rows stay readable for history.

## Sync script (`scripts/sync-catalog.mjs`, replaces sync-exercises.mjs for exercises; muscles part kept)

- `--dry-run`: fetch, select, map, write `scripts/out/catalog-plan.json` (selected exercises) and `scripts/out/legacy-map.json` (old ExerciseDB external_id -> new external_id or null, with match reason); no DB writes.
- Normal run: upsert selected rows, upload SVG frames to `exercise-media/frames/...`, set `exercise_catalog_meta`.
- `--replace-legacy` (separate, explicit): applies legacy-map via the two RPCs, then deletes `exercise-media/gifs/*` through the Storage API. Run only after the product owner reviews legacy-map.json.
- `--translate-limit=N`: Turkish `name_tr` and `instructions_tr` where null, via Gemini **Flash Lite** only (`GEMINI_API_KEY`), **20 exercises per request**, at most **30 requests per run** (default), and never below the user reserve: reuse the `liteBudget()` logic from `scripts/sync-foods.mjs` (Pacific-day usage from `ai_usage_log` vs `app_config.ai_model_limits`, keep 100 for users) and log each request to `ai_usage_log` with action `catalog_translate`. Machine translations add `"translated to Turkish (machine)"` to `attribution.changes`. (Superseded 2026-11-02: names are English only, see below.)
- deploy.yml: replace the exercise sync step (if any) with `node scripts/sync-catalog.mjs --translate-limit=30` (continue-on-error), like the food sync.

## Client

- Exercise media = `media_frames` (signed URLs, cached by path like today's GIFs) shown as a flipbook (~700 ms per frame; first frame only with `prefers-reduced-motion`); no frames -> the existing MuscleMap.
- Exercise detail: one credit line from `attribution` (e.g. "Text: wger contributors, CC BY-SA 4.0 · Illustration: Bryl Lim / Everkinetic, CC BY-SA 4.0 · Turkish: machine translation").
- New page **Profile > About > Licences** (`/settings/licenses`, TR + EN): wger, workout-guide/Everkinetic, Termininja muscle diagrams, USDA FoodData Central citation, Open Food Facts (ODbL), fonts (OFL), main OSS libraries (MIT/ISC); link from the About section. Open Food Facts credit line under food search results if missing.
- Hide `legacy` rows in library/pickers; history still shows their names.

## 2026-11-02 changes (owner decisions)

- **Names English only.** `name_tr` is never written by the sync (migration `20261200000000_exercisedb_media.sql` clears it on catalog rows); `scripts/exercise-names-tr.json` and the curated-name step are gone.
- **Turkish instructions only.** `--translate-limit` now translates `instructions_tr` from `instructions_en` (20 per request, Flash Lite only, user reserve kept, 4.5 s pacing); an existing `instructions_tr` is never overwritten.
- **Generated instructions.** Rows with empty `instructions_en` (~182 workout-guide rows, plus any wger row without text) get 3-8 steps in English and Turkish from Gemini, 10 per request, prompted with 3-4 real rows of a similar body part as style examples (name, equipment, body part, target and secondary muscles given). Strict validation (3-8 steps, 20-220 chars each, same count in both languages, no numbering, markup or medical wording); invalid items are skipped. `attribution.changes` gets `"instructions: generated by AI (Gemini), not from the source"` (plus the machine-translation note). Generated rows are not regenerated; an empty source never wipes them, and if the source later brings its own text, it replaces the generated steps and `instructions_tr` is cleared for re-translation.
- **ExerciseDB ids.** The sync loads the ExerciseDB v1 list (`oss.exercisedb.dev/api/v1/exercises`, keyset pages of 25 (`after=<nextCursor>`), >= 2 s apart, backoff on Cloudflare 429/HTML up to ~2 min, descriptive User-Agent) into memory only and sets `exercises.exercisedb_id` / `exercisedb_match` (service_role, only when changed; rows with `exercisedb_match = 'manual'` are never touched). Methods: `exact` (normalised names equal: spelling variants, plurals, abbreviations, token order, equipment and posture words removed; compatible equipment), `fuzzy` (token-set similarity >= 0.75, no differing exercise-changing word, compatible equipment and target muscles; an id is shared only between equivalent names), `ai` (Gemini picks one of the row's top 8 candidates or null, 20 rows per request; only listed ids accepted). Earlier `ai` answers are kept while the id still exists. If the list cannot be loaded, matching is skipped and nothing is cleared. The app hot-links `https://static.exercisedb.dev/media/<id>.gif` (docs/LICENSING.md); ExerciseDB names, text and media are never stored. `--skip-exercisedb` skips the step, `--exercisedb-file=<path>` reads a local list (development). `--dry-run` writes `scripts/out/exercisedb-match.json` (gitignored: counts, deterministic pairs, unmatched rows with candidates).
- **Order and budget.** Match (deterministic, then AI), generate, translate. All three share one Gemini budget: `--translate-limit=N` caps the requests of the whole run (default 30; workflow input `translate_limit`), `liteBudget()` keeps the user reserve, a 429 stops every AI step. All requests are logged to `ai_usage_log` as `catalog_translate` (the action check constraint has no other catalog value).
