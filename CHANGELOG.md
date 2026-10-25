# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/) (`MAJOR.MINOR.PATCH`; `0.x` while pre-launch, each phase bumps MINOR).

## [Unreleased]

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
