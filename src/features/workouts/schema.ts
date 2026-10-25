import { z } from 'zod'
import type { Tables } from '@/lib/database.types'
import { CARDIO_ACTIVITIES } from './logic'

// -----------------------------------------------------------------------------
// Row types (generated) and the shapes the UI works with
// -----------------------------------------------------------------------------
export type WorkoutTemplate = Tables<'workout_templates'>
export type TemplateExercise = Tables<'template_exercises'>
export type WorkoutSession = Tables<'workout_sessions'>
export type SessionExercise = Tables<'session_exercises'>
export type SessionSet = Tables<'session_sets'>
export type CardioEntry = Tables<'cardio_entries'>

export type TemplateWithExercises = WorkoutTemplate & { template_exercises: TemplateExercise[] }

export type TargetInfo = Pick<TemplateExercise, 'exercise_id' | 'position' | 'target_sets' | 'target_reps_low' | 'target_reps_high' | 'rest_seconds'>

export type BundleExercise = SessionExercise & { sets: SessionSet[]; target: TargetInfo | null }

/** Everything the live session and the detail screen need, in display order. */
export type SessionBundle = {
  session: WorkoutSession
  templateName: string | null
  exercises: BundleExercise[]
  cardio: CardioEntry[]
}

export type HistoryItem = Pick<
  WorkoutSession,
  'id' | 'kind' | 'title' | 'started_at' | 'ended_at' | 'duration_sec' | 'total_sets' | 'total_volume_kg' | 'template_id' | 'kcal_estimate'
> & {
  templateName: string | null
  cardio: Pick<CardioEntry, 'activity' | 'duration_sec' | 'distance_m'>[]
}

// -----------------------------------------------------------------------------
// Forms
// -----------------------------------------------------------------------------
export const templateExerciseInput = z
  .object({
    id: z.string().min(1),
    exercise_id: z.string().min(1),
    target_sets: z.number().int().min(1).max(50),
    target_reps_low: z.number().int().min(1).max(500),
    target_reps_high: z.number().int().min(1).max(500),
    rest_seconds: z.number().int().min(0).max(3600),
  })
  .refine((v) => v.target_reps_high >= v.target_reps_low, { path: ['target_reps_high'], message: 'repsRange' })

export const templateInput = z.object({
  name: z.string().trim().min(1, 'nameRequired').max(80, 'nameTooLong'),
  weekdays: z.array(z.number().int().min(1).max(7)),
  exercises: z.array(templateExerciseInput),
})
export type TemplateInput = z.infer<typeof templateInput>
export type TemplateExerciseInput = z.infer<typeof templateExerciseInput>

export const cardioActivity = z.enum(CARDIO_ACTIVITIES)

export const cardioInput = z.object({
  activity: cardioActivity,
  minutes: z.number().min(1).max(1440),
  distanceKm: z.number().min(0).max(1000).nullable(),
  avgHr: z.number().int().min(30).max(250).nullable(),
})
export type CardioInput = z.infer<typeof cardioInput>

// -----------------------------------------------------------------------------
// RPC payloads
// -----------------------------------------------------------------------------
const num = z.coerce.number()

export const finishSummary = z.object({
  duration_sec: num.default(0),
  total_sets: num.default(0),
  total_volume_kg: num.default(0),
  points_awarded: num.default(0),
  new_prs: z
    .array(
      z.object({
        exercise_id: z.string(),
        e1rm: num,
        weight_kg: num.nullable().optional(),
        reps: num.nullable().optional(),
      }),
    )
    .default([]),
  /** server-side energy estimate, read back from the session after finishing (null: no estimate) */
  kcal_estimate: z.number().nullable().default(null),
  /** body weight the estimate used; null when the 70 kg default was assumed */
  kcal_weight_kg: z.coerce.number().nullable().default(null),
})
export type FinishSummary = z.infer<typeof finishSummary>
