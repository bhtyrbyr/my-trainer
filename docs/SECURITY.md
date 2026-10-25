# Security model: "only your own data"

The product rule: **a user can read or write only rows that belong to them**. Other users are visible only through the public profile fields and the leaderboard RPC. Changing a user id in a URL, query string, request body or Storage path must never return someone else's data.

## Where the rule is enforced (server side, never trusting the client)

| Layer | Mechanism | What it stops |
|---|---|---|
| Postgres RLS | Every user table: `using (user_id = auth.uid() and public.can_access()) with check (user_id = auth.uid() ...)`. `auth.uid()` comes from the verified JWT, not from the request. | `?user_id=<other>` filters, `insert ... user_id = <other>`, `update/delete` of other rows. The query simply sees zero rows. |
| Column protection triggers | `profiles_protect_columns`: clients cannot set `role`, `is_blocked`, `total_points`, streaks. | Self-promotion to admin, fake points. |
| Security-definer RPCs | `get_leaderboard()` returns only public columns; `award_points()` / `revoke_points()` are executable by `service_role` only and are called by DB triggers. `delete_my_account()` uses `auth.uid()` and ignores arguments. | Leaking private columns, client-side point injection, deleting another account. |
| Storage policies | Object path must start with `auth.uid()::text/` for insert/update/delete. Private buckets (`progress-photos`, later `food-temp`) also require it for select. `avatars` is public-read by design (leaderboard). | Uploading into or deleting from another user's folder; downloading another user's private files even with a guessed path. |
| Edge Functions | Derive the user from the `Authorization` JWT via `supabase.auth.getUser()`; never read `user_id` from the body. Use the caller's JWT (not `service_role`) for data access so RLS applies. | Spoofed `user_id` in JSON bodies. |
| Client | Queries never pass `user_id` as a filter for reads (RLS scopes them); they only set `user_id = session.user.id` on inserts (and RLS verifies it anyway). | Nothing security-relevant; UX only. |
| End-to-end encryption | Progress photos are AES-256-GCM encrypted on device; the server stores ciphertext and wrapped keys only. | Even a full database + storage leak or a rogue admin cannot view photos. |

## Rules for new code
1. New table: copy the RLS template from `.claude/skills/db-migrate/SKILL.md`. No table ships without RLS. CI's "RLS sanity" step fails otherwise.
2. Never create a policy with `using (true)` on a table that holds per-user data.
3. Never expose a view over user tables without RLS (`security_invoker = true`) or a function without checking `auth.uid()`.
4. Never use the `service_role` key in the browser or in an Edge Function path that serves user data.
5. Any cross-user feature (friends, challenges) must go through an explicit allow-list table and a security-definer RPC that returns only the fields the owner opted to share.
6. Every phase adds pgTAP cases to `supabase/tests/rls.test.sql`: owner CRUD, second user sees zero rows, forged `user_id` insert is denied.

## Threat checklist used by `qa-reviewer`
- IDOR via query/body/path (covered by RLS + storage path policies)
- Privilege escalation (column protection trigger)
- Point tampering (no client write path to `point_events`)
- Secret leakage (`service_role`, provider keys) in client bundle or repo
- Third-party API calls from the browser (quota theft, key leakage)
- Unencrypted photo bytes in Storage, Cache API, IndexedDB

## AI food estimate (`supabase/functions/ai-coach`)

- Provider keys (`GEMINI_API_KEY`, optional `OPENROUTER_API_KEY`) live only in Supabase Secrets; the browser calls the Edge Function, never a provider.
- The function verifies the caller's JWT, calls `ai_consume()` with the caller's token (per-user `user_settings.ai_daily_limit` and global `app_config.ai_global_daily_limit`), and only then calls the provider.
- Input is limited to a 500-character description and one JPEG/PNG/WebP image (<= ~1.5 MB). The client re-encodes photos to a 1024px JPEG, which drops EXIF/location. Nothing is stored server-side.
- The user text is wrapped as a quoted food description in the prompt; model output is treated as untrusted data and reduced to short strings and clamped numbers before it reaches the client.
- Gemini's free tier may use submitted content to improve Google products; the add-food screen says so and asks users not to send photos with faces or personal details.

## Food catalog and AI usage log

- `food_catalog` is shared reference data: readable by approved users, written only by `scripts/sync-foods.mjs` with the service role in CI. `search_food_catalog()` runs as the caller.
- `food-search` (Open Food Facts) verifies the JWT and `can_access()`, sends a descriptive User-Agent, caches results in memory and returns only normalized numbers and short strings.
- `ai_usage_log` has RLS with no policies. Users write their own rows only through `ai_log_usage()`, which accepts user actions only. Admins read through `admin_ai_usage()`, `admin_ai_live()` and `admin_ai_app_today()`, which check `is_admin()`. Only counts and model names are stored.
