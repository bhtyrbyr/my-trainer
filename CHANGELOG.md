# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/) (`MAJOR.MINOR.PATCH`; `0.x` while pre-launch, each phase bumps MINOR).

## [Unreleased]
### Added
- **Workout energy estimate**: every finished session gets an estimated kcal burned, computed by the database (MET values from the 2024 Compendium of Physical Activities; strength by average RPE, cardio by activity and speed, the Keytel heart-rate equation when heart rate, weight, sex and age are known). Shown in the workout summary, session detail and history, and as "Burned today" on the dashboard. It earns no points and is never added to eaten calories.
- **Body** (Track > Body): weigh-ins and circumferences (waist, chest, hips, arm, thigh), one entry per day. The last weigh-in, 7-day average and monthly change up top; one-tap logging of today's weight; trend chart (1 month to all time) with the 7-day average and an optional private target line; measurement changes and an editable entry log. Weight logs earn 10 points a day, measurements 15 a week (server-side). The workout energy estimate now uses the latest logged weight.
- Track tab is now a hub listing body (live), nutrition, sleep/water and photos (coming next).
- **Nutrition** (Track > Nutrition): daily food log by meal (breakfast, lunch, dinner, snack) with a day switcher. The day's ledger shows eaten calories against the goal and, in a separate column, the workout estimate; the two are never netted. Protein, carbs and fat with an optional protein goal; daily kcal and protein goals.
- **AI food estimate**: describe a meal or take a photo and Google Gemini (free tier) returns items with portions, kcal and macros; every value is editable before it is logged. Runs only through the new `ai-coach` Edge Function (keys in Supabase Secrets, caller's JWT, per-user and global daily limits via `ai_consume`), with an OpenRouter fallback for text. Photos are downscaled and stripped of EXIF on the device, sent only for the estimate, and never stored.
- Saved foods ("my foods") for one-tap re-entry, manual entry, and an eaten / burned card on the dashboard.
- **Food search before AI**: the add-food sheet opens on Search. It looks through saved foods and a new nutrition catalog: 119 Turkish dishes and staples with approximate values, plus USDA FoodData Central Foundation and SR Legacy foods (CC0) with machine-translated Turkish names. Search ignores Turkish accents and case. Packaged products (Turkish brands first) come from Open Food Facts on request through the new `food-search` Edge Function. Picks are portioned in grams. If nothing fits, "Ask the AI" carries the text over.
- Catalog sync (`scripts/sync-foods.mjs`): runs on every deploy (curated list; USDA once; a batch of translations) and as a monthly/manual workflow.
- **Admin AI usage dashboard** (Profile > Admin > AI usage): today's Gemini requests per model against the free-tier limits copied from AI Studio, with the Pacific-midnight reset time and the last-minute rate. It also shows the app's own daily cap, a daily usage trend (tokens or requests; 7, 30 or 90 days) and a who / when / how-much ledger. Only counts are logged, never prompts, photos or answers.
- **AI quota gate**: Gemini's free tier is shared by all users (Flash 20 requests a day, Flash Lite 500; per-minute limits too). Before each request the server checks the user's limit, the app cap and the remaining Google quota per model. It uses Flash while it lasts, then Lite, and refuses once both are spent. The add-food sheet shows the status up front (why, when it renews, what to use meanwhile) and disables the estimate button. Defaults match AI Studio's free-tier limits; catalog translation keeps 100 Lite requests a day for users.
- **Sleep and water** (Track > Sleep and water, and on the Track day view). Water: one-tap +200 (tea glass), +250 (glass) and +500 ml (small bottle), other amounts, a daily goal (editable) and the day's drinks list; +250 ml straight from the Track card. Sleep: bedtime and wake-up for the night ending that morning, a live duration, 1-5 quality, and the last 7 nights as bars against a 7-hour rule with the average. Points: water goal 10; a sleep log 5, or 10 for 7 hours or more (server-side, re-scored on edit, revoked on delete).
- **Body fat estimate**: U.S. Navy circumference method (Hodgdon & Beckett 1984) from height, neck and waist (plus hips for women), with the ACE category. Shown on the body page and the Track body card; when something is missing it says what. Adds the neck measurement.
- Body: height can be set on the body page (private) and the body mass index with its WHO category is shown next to the target.
- **Error reports**: errors the user cannot fix (unexpected, server, timeout, updating) show a "Report to admin" button, also on the crash screen. The report carries the screen, app version, the failing request (method, path, sanitized body; never headers or tokens; photos omitted) and the server's error response. Admins review and resolve reports under Profile > Admin > Error reports.
- **Light theme** (Profile > Appearance: Dark, Light or System). The choice is saved to the account so phone and desktop match, and applied before first paint. In light mode the accent deepens to a readable lime green.
- **Track is the day logbook**: pick any day with the arrows or the calendar (days with records are dotted) and see everything logged on it: one nutrition card (eaten with a progress bar against the daily goal, burned beside it, meals by slot below), a body card (latest weigh-in up to that day and the body mass index with its category) and a workouts card, each opening its module. The Today tab is merged into Track; habits and to-dos will live here.
### Changed
- Deploys only through the gated pipeline: Vercel's own git-triggered deployments are off (they could ship before tests and database migrations), and the Supabase CLI version is pinned in CI.
- Workouts plan filter: "All week" is an explicit default option, each day shows its plan count, today is labelled instead of outlined (the outline read as "selected"), a picked day fills with the accent and a line says what is shown and where plans without days went.
- Bottom bar has five tabs: Home, Track, Workouts (centre, raised volt button), Ranking, Profile.
- Error messages never show technical details to users (they go to the developer console); every message says what to do next. A deploy-in-progress mismatch ("function not found in schema cache") now reads "the app is being updated, refresh in a few minutes".
- Points: 5 per logged food (max 20 a day) and 15 when the protein goal is reached, both server-side and revoked when entries are removed.

## [0.2.0] - 2026-10-25
### Added
- Update banner: when a new version is published, open sessions are told so, count down 15 s and refresh in a controlled way. Sessions check for a new version every minute.
- Admin approval of registrations: new accounts wait in a "pending" state after onboarding; admins review them under Settings -> Admin -> Registration requests (approve / reject, pending badge). `app_config.require_approval` toggles the behaviour. Pending/rejected users see a dedicated waiting screen and cannot read any data except their own profile.
- Design system tokens (olive-tinted neutrals, single volt accent, Bricolage Grotesque display + Inter body, radius/spacing scales, atmosphere and motion utilities) in `src/index.css`.
- `design-director` skill (global) applied to all UI work; frontend agent and CLAUDE.md reference it.
- **Exercise library** (ExerciseDB open-source catalog + wger muscle diagrams, media copied into Supabase Storage): search, body-part / muscle / equipment filters, Turkish names for common exercises, detail page with GIF, muscle map and step-by-step instructions. Monthly sync workflow.
- **Workouts**: templates assigned to weekdays ("today's workout" card on the dashboard), guided live session (set entry prefilled from last time, warm-up sets, RPE, rest timer that survives reloads, next exercise), cardio log, history and session detail, delete with point rollback.
- **Exercise progress**: per-exercise chart of working weight, best weight and estimated 1RM over 4 weeks / 3 months / 1 year / all, with period average and change.
- **Leaderboard** (week / month / all time) with leader card, own-row highlight and streak.
- **Streak tiers**: flame tiers (1-4, 5-14, 15-29, 30-44, 45+ mythic) shown as avatar frames with a flame + day-count badge; dashboard header shows only points and streak.
- Profile tab at the right end of the bottom bar (replaces the header avatar); admins reach registration requests from it, and can permanently delete rejected accounts.
- Build commit shown next to the version (links to GitHub).
- CI runs the pgTAP database suite on a local Supabase before any production deploy.
### Changed
- Login screen redesigned: editorial headline, proof points as numbers, thumb-zone CTA, desktop split layout.
- All components migrated from Tailwind slate/cyan defaults to the token system.
- Points and streaks use the local calendar day (Europe/Istanbul) instead of UTC.
- **Scoring integrity** (QA review): a strength session earns points only with at least 3 working sets and cardio only from 10 minutes; a session can be finished only once; the first log of an exercise is a baseline, not a PR; custom exercises earn no PR points; PR points capped at 40 per day; client can no longer edit session timestamps or totals or delete PRs; caps are race-safe; streak bonuses are rolled back with the activity that earned them.
- Signing out, or a different account signing in on the same device, clears the previous user's cached data (query cache, workout drafts, offline API cache).
- Routes are lazy-loaded and vendor code is split into stable chunks (main bundle 913 KB to 240 KB).
- Live session shows the movement GIF playing in a 128px card; tap to enlarge it to a full-width stage (remembered per device).
- Exercise media cache is keyed without the signed-URL token; touch targets and search inputs tuned for iPhone.
### Fixed
- Security: database functions are no longer executable by clients unless explicitly granted (allow-list enforced by pgTAP).
- Scroll position resets on every tab change.

## [0.1.0] - 2026-10-25
### Added
- Project skeleton: Vite 7, React 19, TypeScript, Tailwind v4, TanStack Query, react-i18next (TR/EN), PWA manifest + service worker.
- Google sign-in via Supabase Auth; auth state machine (signed-out / onboarding / blocked / ready).
- Mandatory onboarding: unique username, display name, profile photo (camera, library or Google photo), optional body info, leaderboard visibility.
- Database core: `app_config` (access mode open/invite), `allowed_emails`, `profiles` (public) + `profile_private`, `user_settings`, points engine (`point_rules`, `point_events`, `award_points`, `revoke_points`), `get_leaderboard` RPC, `delete_my_account`, `avatars` bucket with per-user policies.
- Row Level Security on every table; column-protection trigger for role/points; pgTAP suite.
- GitHub Actions: CI (typecheck, lint, tests, i18n parity, build, secret scan, RLS sanity, PR preview), production deploy (Supabase migrations + Edge Functions + Vercel), Supabase keep-alive, GitHub Release on tag.
- Sub-agents (`db-architect`, `frontend-dev`, `qa-reviewer`, `i18n-checker`) and skills (`/db-migrate`, `/new-feature`, `/release-check`).
- Docs: PRD, SECURITY, CLAUDE.md, README.
