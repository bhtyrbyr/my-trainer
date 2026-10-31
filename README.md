# my-trainer

Live: https://my-trainer-nine.vercel.app

Fitness, nutrition, habit and to-do tracker with points and a leaderboard. Google sign-in, free-tier only, privacy first (each user sees only their own data; progress photos are end-to-end encrypted).
**Private use**: the owner and invited people only; not published and kept out of search engines (`robots.txt`, `noindex`).
Requirements and architecture: [docs/PRD.md](docs/PRD.md).

## One-time setup
1. **Supabase**: create a free project. Settings -> API: copy URL + anon key into `.env.local` (see `.env.example`).
2. **Google OAuth**: Google Cloud Console -> OAuth client (Web). Authorized redirect URI: `https://<ref>.supabase.co/auth/v1/callback`. Paste client id/secret into Supabase -> Authentication -> Providers -> Google. Disable Email provider.
3. **Schema**: `npx supabase login`, `npx supabase link --project-ref <ref>`, `npx supabase db push`.
4. **Seed**: edit `supabase/seed.sql` (your Google email as `admin_bootstrap_email`) and run it in the SQL editor. That account becomes admin after onboarding.
5. **Run locally**: `npm install && npm run dev`, open the LAN URL on your phone. Add `http://<lan-ip>:5173` to Supabase Auth -> URL Configuration -> Redirect URLs for phone testing.
6. **Vercel**: import the GitHub repo, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` env vars. Add `https://<app>.vercel.app` to Supabase Auth URL Configuration (Site URL + Redirect URLs).
7. **GitHub Secrets** (Settings -> Secrets and variables -> Actions): `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (catalog sync and push setup in CI only), `GEMINI_API_KEY` (catalog translation). Push reminders: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_DISPATCH_SECRET` (also signs AI coach replies; the deploy copies them to Supabase secrets).
8. **Supabase Edge Function secrets**: `GEMINI_API_KEY`, optional `OPENROUTER_API_KEY` (AI food estimate and coach).

## CI/CD
- Every push/PR: typecheck, lint, tests, i18n parity, build, secret scan, RLS sanity. PRs get a Vercel preview URL as a comment.
- Merge to `main`: after CI passes, `deploy.yml` pushes Supabase migrations + Edge Functions, then deploys production on Vercel.
- `keepalive.yml` pings Supabase daily so the free project never pauses.

## Access modes (admin)
Profile > Admin > Access. `invite` (recommended for private use: only e-mails on the allowed list can sign up) or `open` (anyone with Google can request access). With approval on, every new account waits for the admin. Admins can block users and set per-user AI limits (Admin > Users).

If the Google OAuth app is in *Testing*, add each invited person under Google Cloud > OAuth consent screen > Test users (max 100).

## Maintenance (automatic)
- `keepalive.yml`: daily ping so the free Supabase project never pauses.
- `sync-catalog.yml` / `sync-foods.yml`: monthly catalog syncs (also on deploy).
- `ai-models.yml`: monthly check that the Gemini models in `app_config.ai_model_limits` still exist; a failed run e-mails you. Fix by updating the limits in Admin > AI usage and the model defaults.
- Dependabot: monthly grouped update PRs; merge them only when CI is green.
- Admin > Free tier shows how close the project is to the Supabase Free limits.

## Tests
`npm run test` (unit), `npx supabase test db` (pgTAP, RLS), `npm run test:e2e` (Playwright against the local stack: `npx supabase start` first; creates and deletes its own test user).

## Free-tier limits (checked 2026-10-31)
| Service | Limit that matters | How we stay inside |
|---|---|---|
| Supabase Free | 500 MB database, 1 GB storage, 500k Edge Function calls a month; pauses after 7 days without activity | `keepalive.yml` daily ping; photos downscaled and encrypted; exercise media is small SVG/PNG frames |
| Vercel Hobby | personal, non-commercial use | private app, no ads or payments |
| GitHub Actions | 2,000 minutes a month (private repo) | CI only on push/PR; catalog syncs are monthly or manual |
| Gemini API free tier | per-model daily and per-minute quotas (Flash about 20, Flash Lite about 500 requests a day), reset at midnight Pacific | per-user and app-wide daily caps; coach and food estimate try Flash Lite first; Admin > AI usage shows today's use against the limits (`app_config.ai_model_limits`) |
| OpenRouter free | about 50 requests a day | text fallback only |

## Data sources and attribution
- Exercise texts: [wger](https://wger.de) contributors, CC BY-SA
- Exercise illustrations: [workout-guide](https://github.com/bryllim/workout-guide) by Bryl Lim / Everkinetic, CC BY-SA 4.0
- Muscle diagrams: Termininja via [wger](https://wger.de), CC BY-SA 3.0
- Full list: Profile > About > Licences in the app, and docs/LICENSING.md
