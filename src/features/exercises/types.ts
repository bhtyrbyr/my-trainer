import type { Tables } from '@/lib/database.types'

/** Where a catalog row comes from (catalog v2). `legacy` rows are retired catalog rows kept by name for history. */
export type ExerciseSource = 'wger' | 'workout-guide' | 'legacy' | 'custom'

/** Sources shown in the library, pickers and search; everything else is readable only by id (history). */
export const LISTED_SOURCES = ['wger', 'workout-guide', 'custom'] as const satisfies readonly ExerciseSource[]

/** One credited work: who made it, under which licence, where it lives. */
export type CreditPart = { author?: string | null; license?: string | null; url?: string | null }

/** `exercises.attribution` (jsonb), written by scripts/sync-catalog.mjs. */
export type ExerciseAttribution = {
  text?: CreditPart | null
  media?: CreditPart | null
  /** e.g. "translated to Turkish (machine)" */
  changes?: string[] | null
}

/**
 * Catalog or custom exercise as the app uses it (the generated tsvector column is never selected).
 * `media_frames` / `attribution` are declared here so the code typechecks before and after
 * database.generated.ts picks up the catalog v2 columns; the jsonb column gets its real shape.
 */
export type Exercise = Omit<Tables<'exercises'>, 'search' | 'media_frames' | 'attribution'> & {
  /** storage paths in exercise-media (frames/<slug>/<n>.svg), played in order */
  media_frames: string[]
  attribution: ExerciseAttribution | null
}

export type ExerciseFilters = {
  q?: string
  bodyPart?: string
  muscle?: string
  equipment?: string
}

export const EXERCISE_COLUMNS =
  'id, external_id, source, name_en, name_tr, body_parts, target_muscles, secondary_muscles, equipment, instructions_en, instructions_tr, media_frames, attribution, is_custom, user_id, created_at, updated_at'
