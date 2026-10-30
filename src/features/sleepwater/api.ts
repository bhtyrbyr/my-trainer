import { supabase } from '@/lib/supabase'
import { isDuplicate } from '@/lib/offline/queue'
import type { SleepEntry, WaterEntry } from './types'

/** The caller's drinks for one local day (RLS scopes the rows). */
export async function listWater(day: string): Promise<WaterEntry[]> {
  const { data, error } = await supabase.from('water_entries').select('*').eq('drunk_on', day).order('logged_at')
  if (error) throw error
  return data ?? []
}

/**
 * Log a drink. `id` is generated on the device (offline queue) and `loggedAt` is when the user tapped:
 * a replay of an insert that already reached the server hits the primary key and counts as done.
 */
export async function addWater(userId: string, w: { id: string; day: string; ml: number; loggedAt: string }): Promise<WaterEntry> {
  const { data, error } = await supabase
    .from('water_entries')
    .insert({ id: w.id, user_id: userId, drunk_on: w.day, amount_ml: w.ml, logged_at: w.loggedAt })
    .select('*')
    .single()
  if (error) {
    if (!isDuplicate(error)) throw error
    const { data: existing, error: readError } = await supabase.from('water_entries').select('*').eq('id', w.id).single()
    if (readError) throw readError
    return existing
  }
  return data
}

export async function deleteWater(id: string): Promise<void> {
  const { error } = await supabase.from('water_entries').delete().eq('id', id)
  if (error) throw error
}

/** Nights whose wake-up day falls in [from, to] (inclusive). */
export async function listSleep(from: string, to: string): Promise<SleepEntry[]> {
  const { data, error } = await supabase.from('sleep_entries').select('*').gte('sleep_on', from).lte('sleep_on', to).order('sleep_on')
  if (error) throw error
  return data ?? []
}

/** One night per wake-up day: insert or replace that day's night. The server derives day and duration. */
export async function saveSleep(userId: string, day: string, bedAt: Date, wakeAt: Date, quality: number | null): Promise<void> {
  const { error } = await supabase
    .from('sleep_entries')
    .upsert({ user_id: userId, sleep_on: day, bed_at: bedAt.toISOString(), wake_at: wakeAt.toISOString(), quality }, { onConflict: 'user_id,sleep_on' })
  if (error) throw error
}

export async function deleteSleep(id: string): Promise<void> {
  const { error } = await supabase.from('sleep_entries').delete().eq('id', id)
  if (error) throw error
}
