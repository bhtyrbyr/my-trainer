import { z } from 'zod'

const count = z
  .number()
  .nullish()
  .transform((v) => v ?? 0)
const maybe = z
  .number()
  .nullish()
  .transform((v) => v ?? null)

/**
 * get_week_summary() jsonb. Health parts (sleep, weight, water) are null without health consent;
 * habit_rate is null when nothing was due.
 */
export const weekSummarySchema = z.object({
  week_start: z.string(),
  workouts: count,
  sets: count,
  volume_kg: count,
  cardio_minutes: count,
  habit_rate: maybe,
  todos_done: count,
  avg_sleep_minutes: maybe,
  weight_change_kg: maybe,
  water_goal_days: maybe,
})

export type WeekSummary = z.infer<typeof weekSummarySchema>
