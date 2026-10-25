---
name: new-feature
description: Scaffold a feature module under src/features/<name> for my-trainer (api/hooks/schema/components/pages plus TR/EN locale namespace, route and optional tab entry).
argument-hint: <feature-name> [short description]
---

Scaffold feature: $ARGUMENTS

1. Create `src/features/<name>/` with:
   - `schema.ts`: zod schemas and exported types for the row and insert shapes (match `docs/PRD.md` section 3 and `src/lib/database.types.ts`).
   - `api.ts`: typed Supabase calls (`list`, `get`, `create`, `update`, `remove`) using `supabase.from('<table>')`.
   - `hooks.ts`: TanStack Query hooks `use<Name>List`, `use<Name>Mutations` with `queryKey: ['<name>', ...]` and invalidation.
   - `pages/<Name>Page.tsx`: mobile-first page using `PageShell` from `src/components/layout`.
   - `components/index.ts` (empty barrel).
2. Add `src/locales/tr/<name>.json` and `src/locales/en/<name>.json` with at least `title`, `empty`, `add` keys; register the namespace in `src/lib/i18n.ts`.
3. Add a lazy route in `src/app/router.tsx`. If the feature is a top-level tab, add it to `src/app/BottomNav.tsx` (max 5 tabs; if full, nest under "More").
4. Run `npm run typecheck && npm run lint`.
5. Report created files and the next implementation steps.
