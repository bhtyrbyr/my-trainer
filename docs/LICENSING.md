# Third-party licences and terms (review of 2026-10-30)

Research summary, not legal advice. Items marked **[lawyer]** need a Turkish IP/KVKK lawyer. Full source list at the end.

| Item | Terms | Verdict | What it means for us |
|---|---|---|---|
| ExerciseDB (**removed 2026-10-30**: data, GIFs and code deleted; replaced by wger + workout-guide) | oss.exercisedb.dev: "All rights reserved"; API Terms (8 Jun 2026): content incl. animations owned by ExerciseDB API, licence only for subscribers, **caching / mirroring / redistribution prohibited**; free endpoints "for exploration only". Code repo is AGPL-3.0 (code only). GIF origin possibly Gym Visual (paid licences). | **Blocker** | Our bulk copy and self-hosting is what the terms forbid. Before a public launch: a written licence (AscendAPI and/or the real rights holder) or replacement media/text. **[lawyer]** |
| wger muscle SVGs | Based on Wikimedia "Muscular system" by Termininja, **CC BY-SA 3.0** | OK with obligations | Credit + licence link on an About/Licences page; share-alike covers only the (adapted) images, not our code. |
| USDA FoodData Central | Public domain / CC0 | OK | Citation requested: "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central". Turkish names are our machine translation. |
| Open Food Facts (live search) | ODbL 1.0 (database), DbCL (contents), CC BY-SA (images); not for medical use | OK with obligations | Credit "Open Food Facts" + link near the results; descriptive User-Agent (done); API usage form; **10 searches/min per IP** (all users share the server IP: explicit search button and caching, already in place); no shared cross-user OFF table unless released under ODbL. **[lawyer]** for private per-user logs. |
| Google Gemini API (free tier) | Additional Terms (Mar/Apr 2026): **18+ only**, clients must not be likely accessed by under-18s; free-tier inputs/outputs used to improve products and **may be read by human reviewers**; "do not submit personal information"; EEA/UK/CH users only on paid services; no medical advice | **Risky** | Needs: 18+ rule, explicit notice/consent before first AI use, no identifiers sent (EXIF already stripped), off for EEA/UK/CH, "estimate, not medical advice". The clean fix is the paid tier (conflicts with free-only). |
| OpenRouter free models | ToS (31 Aug 2026): 18+, users bound to model terms, some free providers log/train on inputs | **Risky** | Same mitigations as Gemini; pin specific models and turn off training/logging providers. |
| Vercel Hobby | Non-commercial personal use; ads, payments, sponsors, affiliate links or paid contributors make it commercial; donations are not | OK while free | Re-check before any monetisation. |
| Supabase Free, GitHub Actions | No production ban; 7-day inactivity pause | OK | Keep the keep-alive workflow. |
| Google Sign-In | OAuth app must be **In production**; brand verification needs a public homepage, privacy policy and terms on a domain verified in Search Console | OK with obligations | Without a custom domain the consent screen shows the supabase.co host. A custom domain is advisable. |
| Web Push | Standard Web Push, no account needed | OK | Mentioned in the privacy notice. |
| Fonts and libraries (Inter, Bricolage Grotesque: OFL 1.1; lucide: ISC/MIT; React, Recharts, TanStack, i18next, hash-wasm: MIT) | Permissive | OK with obligations | Ship a third-party notices page (licence texts). |
| App name "My Trainer" | Trademark | **Risky** | Similar fitness apps exist (e.g. "MyTrainer: AI Coach", "My Trainer" on iOS). Check TÜRKPATENT and the stores; choose a distinctive name before marketing. **[lawyer]** |

## Before a public launch

1. ~~Replace or license the ExerciseDB GIFs and copied texts.~~ Done 2026-10-30 (catalog v2).
2. ~~AI: 18+ rule, explicit consent naming Google and OpenRouter, no identifiers, off for EEA/UK/CH, "not medical advice".~~ Done 2026-10-30 (kept on the free tier by the product owner's decision). The region check depends on a country header from the edge; users also self-declare it.
3. About/Licences page (TR + EN): Open Food Facts, USDA, wger/Termininja, OSS and font notices; OFF credit under food search.
4. Open Food Facts: API usage form.
5. Google OAuth: production mode, homepage + privacy policy + terms on a verified (custom) domain, brand verification.
6. Name: trademark check, then rename via `src/config/brand.json`.
7. Stay non-commercial on Vercel Hobby.

## Sources

ExerciseDB: https://oss.exercisedb.dev, https://github.com/ExerciseDB/exercisedb-api, https://edb-docs.up.railway.app/docs/api-terms-of-use, https://gymvisual.com ·
wger: https://raw.githubusercontent.com/wger-project/wger/master/wger/core/static/images/muscles/SOURCES, https://commons.wikimedia.org/wiki/File:Muscular_system.svg ·
USDA: https://catalog.data.gov/dataset/fooddata-central ·
Open Food Facts: https://world.openfoodfacts.org/terms-of-use, https://openfoodfacts.github.io/openfoodfacts-server/api/, https://opendatacommons.org/licenses/odbl/1-0/ ·
Gemini: https://ai.google.dev/gemini-api/terms, https://ai.google.dev/gemini-api/docs/available-regions ·
OpenRouter: https://openrouter.ai/terms, https://openrouter.ai/docs/guides/privacy/provider-logging ·
Vercel: https://vercel.com/docs/limits/fair-use-guidelines ·
Supabase: https://supabase.com/docs/guides/platform/free-project-pausing ·
Google OAuth: https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification, https://developers.google.com/terms/api-services-user-data-policy ·
Fonts: https://openfontlicense.org/open-font-license-official-text/
