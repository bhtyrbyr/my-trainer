import type { Tables } from '@/lib/database.types'

export type SleepEntry = Tables<'sleep_entries'>
export type WaterEntry = Tables<'water_entries'>

/** One-tap water amounts (ml): a tea glass, a glass, a small bottle. */
export const WATER_QUICK = [200, 250, 500] as const
export const DEFAULT_WATER_GOAL = 2500
