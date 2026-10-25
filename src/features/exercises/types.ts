import type { Tables } from '@/lib/database.types'

/** Catalog or custom exercise as the app uses it (the generated tsvector column is never selected). */
export type Exercise = Omit<Tables<'exercises'>, 'search'>

export type ExerciseFilters = {
  q?: string
  bodyPart?: string
  muscle?: string
  equipment?: string
}

export const EXERCISE_COLUMNS =
  'id, external_id, source, name_en, name_tr, body_parts, target_muscles, secondary_muscles, equipment, instructions_en, instructions_tr, gif_path, is_custom, user_id, created_at, updated_at'
