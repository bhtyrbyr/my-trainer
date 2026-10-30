# my-trainer: Claude Code project guide

Multi-user fitness + habit tracker with points and a leaderboard. **Free-tier only. Google sign-in. Each user sees only their own data. Privacy first.**
Full requirements and architecture: `docs/PRD.md` (read sections 1-3 before implementing anything).

## Stack
React 19 + Vite 7 + TypeScript + Tailwind v4 + shadcn-style UI, TanStack Query, Supabase (Postgres, Auth/Google, Storage, Edge Functions), react-i18next (TR/EN), vite-plugin-pwa, Vercel Hobby, GitHub Actions CI/CD.

## Commands
- `npm run dev`: dev server, LAN exposed for phone testing
- `npm run typecheck` / `npm run lint` / `npm run test` / `npm run i18n:check`
- `npm run release:check`: full gate (also the `/release-check` skill)
- `npx supabase db push`: apply migrations to the hosted project; `npx supabase db reset`: local (Docker); `npx supabase test db`: pgTAP
- `npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts`

## Hard rules
1. **Every** user table: RLS on, policies `user_id = auth.uid() and public.can_access()`. Cross-user data only via `profiles` public columns or security-definer RPCs (`get_leaderboard`). No exceptions.
2. Points are written only by DB triggers via `award_points()` / `revoke_points()`. Clients never insert `point_events`. Rules: `docs/PRD.md` section 1.4 and table `point_rules`.
3. The `service_role` key never appears in `src/`, `vite.config.ts` or committed env files. Only GitHub Secrets / Supabase Secrets.
4. Third-party APIs (Gemini, OpenRouter, ExerciseDB, wger) are called only from `supabase/functions/*` or `scripts/*`, never from the browser.
5. Progress photos are encrypted client-side (`src/lib/crypto/`) before any upload; the service worker never caches the `progress-photos` bucket; plaintext never touches IndexedDB/localStorage.
6. All UI text through `t()`; add TR **and** EN keys together; register new namespaces in `src/lib/i18n.ts`.
7. Mobile first for **iPhone 16** (393x852, safe-area insets); desktop is a wider layout of the same screens. Five bottom tabs (Home, Track, Workouts in the centre as a raised volt disc, Ranking, Profile); Track is the day logbook (calendar) and absorbs habits/to-dos in Faz 3; no avatar/gear in page headers.
7b. **Every screen goes through the `design-director` skill** (`~/.claude/skills/design-director`): functional draft, interrogation, elevation, restraint, rendered verification at 393x852. Use the token system in `src/index.css` (`bg/surface/raised/line/ink/ink-muted/ink-faint/volt`, `display`/`eyebrow`/`hairline`/`inner-glow`/`bg-atmosphere`/`rise-in` utilities). No raw slate/indigo defaults, no four-identical-cards layouts, no drop-shadow boxes.
8. New migrations only; never edit an applied migration. Functions in `public` are NOT executable by anon/authenticated by default (default privileges revoked in 20261026040000); every RPC needs an explicit `grant execute ... to authenticated`, and internal helpers (award_points, trigger functions) must never be granted. pgTAP enforces an allow-list.
9. Git: develop on a feature branch; commit locally with Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`); **push / open PR only after the user approves**. CI runs on PR, production deploy runs after merge to `main`.
10. **Anti-IDOR**: never trust a `user_id` from a URL, body or path. Reads rely on RLS (no client-side `user_id` filter needed); Edge Functions derive the user from the JWT and query with the caller's token, never `service_role`. Storage paths start with `auth.uid()`. Details: `docs/SECURITY.md`.
11. Versioning: SemVer, `package.json` is the source of truth (`__APP_VERSION__` in the UI). Each phase: update `CHANGELOG.md` (Keep a Changelog), then `npm version minor` and `git push --follow-tags`; the `release.yml` workflow publishes a GitHub Release from the changelog section.

## Layout
```
src/app        router, providers, AppShell, BottomNav
src/features   auth, profile (onboarding), leaderboard, workouts, exercises, track (body/nutrition/sleep-water/photos), today (habits/todos), dashboard, ai-coach, settings, admin
src/lib        supabase.ts, i18n.ts, image.ts, crypto/, units.ts, dates.ts, database.types.ts
src/components ui/ (primitives), layout/ (PageShell, HeaderActions, ...)
src/locales    tr/*.json, en/*.json (one namespace per feature)
supabase       migrations/, functions/ai-coach, seed.sql, tests/rls.test.sql
scripts        sync-exercises.ts, check-i18n.mjs, gen-icons.mjs
.github        ci.yml (checks + PR preview), deploy.yml (Supabase + Vercel prod), keepalive.yml
```

## Sub-agents and skills
Agents in `.claude/agents`: `db-architect`, `frontend-dev`, `qa-reviewer` (read-only), `i18n-checker` (read-only).
Skills: `/db-migrate <slug>`, `/new-feature <name>`, `/release-check`.
The product owner (main session) coordinates; each phase ends with `qa-reviewer` + `/release-check` before user sign-off.

## Phase status
- [x] Faz 0: skeleton, Google auth, onboarding (mandatory avatar), access mode, points engine, CI/CD. Live: https://my-trainer-nine.vercel.app (Supabase ref tnamatnobmtxvdtovkzp, GitHub bhtyrbyr/my-trainer).
- [x] Faz 1: workouts (ExerciseDB + wger sync, guided session flow) + leaderboard UI (v0.2.0)
- [x] Faz 2: body, nutrition (+ Gemini food lookup), sleep/water, encrypted progress photos, KVKK (v0.3.0)
- [x] Faz 3: habits + todos (shared recurrence engine), push reminders (v0.4.0)
- [ ] Faz 4: dashboard, AI coach (Edge Function), badges, admin panel, offline queue, export
- [ ] Faz 5: hardening + publish
