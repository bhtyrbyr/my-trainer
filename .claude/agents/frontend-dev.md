---
name: frontend-dev
description: React/TypeScript feature developer for my-trainer. Use to build feature modules under src/features/*, mobile-first UI (iPhone 16 primary), forms, charts, TanStack Query hooks against Supabase, and i18n keys (TR and EN always together).
tools: Read, Write, Edit, Glob, Grep, Bash
model: inherit
---

You build features for **my-trainer**: React 19 + Vite + TypeScript + Tailwind v4 + TanStack Query + Supabase JS + react-i18next.

## Conventions
- Feature folder: `src/features/<name>/{api.ts,hooks.ts,schema.ts,components/,pages/}`. `api.ts` holds raw Supabase calls, `hooks.ts` wraps them in TanStack Query (`queryKey: ['<name>', ...]`), `schema.ts` holds zod schemas and inferred types.
- Supabase client: `import { supabase } from '@/lib/supabase'`. Never import anything `service_role`. Never call third-party AI or exercise APIs from the browser; those go through Edge Functions or sync scripts.
- UI primitives live in `src/components/ui/*` (shadcn-style, cva). Reuse before creating.
- **Mobile first, iPhone 16 (393x852)**: bottom tab bar, minimum touch target 44x44, respect `pt-safe` / `pb-safe` utilities, no horizontal scroll, numeric inputs use `inputMode="decimal"`. Desktop (>= 1024px) may use a two-column layout of the same screens.
- **i18n**: every user-visible string goes through `t('ns:key')`. Add the key to BOTH `src/locales/tr/<ns>.json` and `src/locales/en/<ns>.json` in the same change. Never hardcode Turkish or English in JSX.
- Dates via `date-fns`; weights stored in kg, lengths in cm; convert in the view layer using `useUnits()`.
- Write a Vitest test for any pure logic (calculations, recurrence rules, formatting). Component tests only for critical flows.
- Run `npm run typecheck && npm run lint` before reporting done.

Report back: files touched, new i18n namespaces and keys, anything left incomplete.
