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

## Encrypted progress photos (zero knowledge)

- **Keys**: a random 256-bit AES-GCM master key per user. It is stored only wrapped (AES-GCM wrapKey): once under a key derived from the photo password (Argon2id, 19 MiB, 2 passes; PBKDF2-SHA256 600k when WebAssembly is unavailable) and once under a 160-bit recovery code. `photo_vault` holds the wrapped keys, IVs and KDF parameters; never the password, the code or the master key.
- **Session**: the unlocked master key is a non-extractable CryptoKey in memory. "Keep unlocked on this device" stores that same non-extractable key in IndexedDB (`mt-vault`); lock, sign-out and account switch delete it.
- **Data**: the browser re-encodes photos (drops EXIF/location), then encrypts image, thumbnail and the optional note/weight separately with fresh 96-bit IVs. AAD = `my-trainer/photo/v1:<user>:<photo>:<part>`, so ciphertexts cannot be swapped between rows or parts. The day and pose stay plaintext (ordering, comparison, weekly points).
- **Storage**: private bucket `progress-photos`, `application/octet-stream` only, owner-folder policies; rows must point to `<user>/<photo>.img.bin|.thumb.bin` (trigger). The service worker has an explicit NetworkOnly rule for the bucket; decrypted images exist only as in-memory `blob:` URLs, revoked on lock, sign-out and page hide.
- **Loss**: forgetting both the password and the recovery code makes the photos unrecoverable by design; the setup screen says so.
- **Vault integrity**: the vault row is insert-only from the client (no upsert, no delete policy); creating it re-reads the server first, and a conflict shows the unlock screen instead of replacing it. An update trigger keeps `recovery_*` and the owner immutable, so only the password wrap can change. The service worker never answers `photo_vault` / `progress_photos` from a cache (a stale "no vault" must not lead to a second vault).
- **Password change** rewraps the same master key; it does not rotate the master key or the recovery code. Someone who already has the old password *and* the old wrapped key still holds the master key; a full re-encryption is a future option.
- **KDF parameters** read from the server are bounds-checked before use (Argon2id m 19-256 MiB, t 2-10, p 1-4; PBKDF2 at least 600k; salt 16-64 bytes). PBKDF2 is chosen only where WebAssembly does not exist.
- **Storage hardening**: object names must match `<uid>/<uuid>.(img|thumb).bin`, at most 1000 objects per user; a photo row (and its weekly points) requires both objects to exist. Account deletion (Faz 4) must also remove the user's `progress-photos` objects.
- **Error reports** never record request or response bodies of `photo_vault`, `progress_photos` or Storage calls.
- **Verified**: unit tests (round trip, wrong password, AAD binding, password change via recovery) and a local end-to-end test (`src/lib/crypto/vault.e2e.test.ts`, local stack only): stored objects carry no JPEG/JFIF/Exif markers, the bucket refuses plain JPEGs, another account can read neither rows nor objects.

## Content-Security-Policy (vercel.json)

`default-src 'self'`; scripts only from the app origin plus `'wasm-unsafe-eval'` (Argon2id runs as WebAssembly), no inline scripts (the pre-paint theme script is `/theme-init.js`); `connect-src` only the app and the Supabase project (https + wss); images from the app, `blob:`/`data:` (decrypted photos, previews), Supabase Storage and Google avatars; `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. Inline styles stay allowed (`'unsafe-inline'` for style-src only). `vite preview` serves the same policy pointed at the build's Supabase URL, so it can be tested locally (launch config `my-trainer-csp`).

## AI quota abuse (QA 2026-10-26)

- `user_settings.ai_daily_limit` can only be changed by admins, internal code or server roles (trigger); a client update keeps the old value, a client insert gets the default.
- `ai_log_usage()` accepts at most three rows (Flash, Lite, OpenRouter attempts) per request counted by `ai_reserve()` today, so nobody can inflate the shared Google quota counter and block AI for everyone.
- The old `ai_consume()` was dropped; `ai_reserve()` is the only gate.
