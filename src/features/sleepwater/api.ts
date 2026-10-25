import { supabase } from '@/lib/supabase'
import type { SleepEntry, WaterEntry } from './types'

/** The caller's drinks for one local day (RLS scopes the rows). */
export async function listWater(day: string): Promise<WaterEntry[]> {
  const { data, error } = await supabase.from('water_entries').select('*').eq('drunk_on', day).order('logged_at')
  if (error) throw error
  return data ?? []
}

export async function addWater(userId: string, day: string, ml: number): Promise<void> {
  const { error } = await supabase.from('water_entries').insert({ user_id: userId, drunk_on: day, amount_ml: ml })
  if (error) throw error
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
