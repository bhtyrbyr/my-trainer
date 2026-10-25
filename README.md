# my-trainer

Fitness, nutrition, habit and to-do tracker with points and a leaderboard. Google sign-in, free-tier only, privacy first (each user sees only their own data; progress photos are end-to-end encrypted).
Requirements and architecture: [docs/PRD.md](docs/PRD.md).

## One-time setup
1. **Supabase**: create a free project. Settings -> API: copy URL + anon key into `.env.local` (see `.env.example`).
2. **Google OAuth**: Google Cloud Console -> OAuth client (Web). Authorized redirect URI: `https://<ref>.supabase.co/auth/v1/callback`. Paste client id/secret into Supabase -> Authentication -> Providers -> Google. Disable Email provider.
3. **Schema**: `npx supabase login`, `npx supabase link --project-ref <ref>`, `npx supabase db push`.
4. **Seed**: edit `supabase/seed.sql` (your Google email as `admin_bootstrap_email`) and run it in the SQL editor. That account becomes admin after onboarding.
5. **Run locally**: `npm install && npm run dev`, open the LAN URL on your phone. Add `http://<lan-ip>:5173` to Supabase Auth -> URL Configuration -> Redirect URLs for phone testing.
6. **Vercel**: import the GitHub repo, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` env vars. Add `https://<app>.vercel.app` to Supabase Auth URL Configuration (Site URL + Redirect URLs).
7. **GitHub Secrets** (Settings -> Secrets and variables -> Actions): `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

## CI/CD
- Every push/PR: typecheck, lint, tests, i18n parity, build, secret scan, RLS sanity. PRs get a Vercel preview URL as a comment.
- Merge to `main`: after CI passes, `deploy.yml` pushes Supabase migrations + Edge Functions, then deploys production on Vercel.
- `keepalive.yml` pings Supabase daily so the free project never pauses.

## Access modes (admin)
`app_config.access_mode`: `open` (default, anyone with Google) or `invite` (only emails in `allowed_emails`). Admins can also block users (`profiles.is_blocked`).

## Data sources and attribution
- Exercise catalog & GIFs: [ExerciseDB (open source)](https://exercisedb.dev)
- Muscle diagrams: [wger](https://wger.de), CC-BY-SA
