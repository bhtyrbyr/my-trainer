import { supabase } from '@/lib/supabase'
import type { BodyMetric, BodyMetricInput } from './types'

/** All of the caller's rows (RLS scopes them; no client-side user filter). Newest first. */
export async function listBodyMetrics(): Promise<BodyMetric[]> {
  const { data, error } = await supabase.from('body_metrics').select('*').order('measured_on', { ascending: false }).limit(2000)
  if (error) throw error
  return data ?? []
}

/**
 * One row per day: insert, or merge only the given columns into that day's row.
 * user_id is required by the insert policy, which checks it equals auth.uid().
 */
export async function saveBodyMetric(userId: string, input: BodyMetricInput): Promise<void> {
  const { error } = await supabase.from('body_metrics').upsert({ ...input, user_id: userId }, { onConflict: 'user_id,measured_on' })
  if (error) throw error
}

export async function deleteBodyMetric(id: string): Promise<void> {
  const { error } = await supabase.from('body_metrics').delete().eq('id', id)
  if (error) throw error
}

/** Private weights: the goal (chart line) and the onboarding start weight (first prefill). */
export async function getPrivateWeights(): Promise<{ target: number | null; start: number | null }> {
  const { data, error } = await supabase.from('profile_private').select('target_weight_kg, start_weight_kg').maybeSingle()
  if (error) throw error
  const num = (v: number | null | undefined) => (v == null ? null : Number(v))
  return { target: num(data?.target_weight_kg), start: num(data?.start_weight_kg) }
}

export async function setTargetWeight(userId: string, kg: number | null): Promise<void> {
  const { error } = await supabase.from('profile_private').upsert({ user_id: userId, target_weight_kg: kg }, { onConflict: 'user_id' })
  if (error) throw error
}
