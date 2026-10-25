import type { Tables, TablesInsert } from '@/lib/database.types'

export type BodyMetric = Tables<'body_metrics'>
export type BodyMetricInput = Omit<TablesInsert<'body_metrics'>, 'user_id' | 'id' | 'created_at' | 'updated_at'>

/** Circumference fields, in the order they are listed on screen. */
export const MEASURE_FIELDS = ['neck_cm', 'waist_cm', 'chest_cm', 'hip_cm', 'arm_cm', 'thigh_cm'] as const
export type MeasureField = (typeof MEASURE_FIELDS)[number]

export const WEIGHT_PERIODS = ['1m', '3m', '1y', 'all'] as const
export type WeightPeriod = (typeof WEIGHT_PERIODS)[number]
