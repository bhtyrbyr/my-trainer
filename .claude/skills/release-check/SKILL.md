---
name: release-check
description: Full pre-deploy gate for my-trainer. Typecheck, lint, unit tests, i18n parity, production build, secret scan and RLS sanity. Use before every merge to main / Vercel deploy.
---

Run the release gate for my-trainer and report PASS/FAIL per step. Stop at the first failure and explain how to fix it.

1. `npm run typecheck`
2. `npm run lint`
3. `npm run test`
4. `npm run i18n:check`
5. `npm run build`, then confirm `dist/sw.js` and `dist/manifest.webmanifest` exist.
6. Secret scan: `grep -rniE "service_role" src scripts` must be empty; `grep -rnE "AIza[0-9A-Za-z_-]{30,}|sk-or-v1-[0-9a-f]{20,}" src scripts supabase .github` must be empty; and `git ls-files | grep -E "^\.env"` must list only `.env.example`.
7. RLS sanity: every `create table` in `supabase/migrations/*.sql` must be followed in the same file by `enable row level security` for that table. List any offenders.
8. Browser-side third-party check: `grep -rniE "generativelanguage.googleapis.com|openrouter.ai|exercisedb.dev|wger.de" src/` must be empty (those belong in Edge Functions and scripts only).
9. If all pass: print "READY TO DEPLOY" and a short git status summary.
