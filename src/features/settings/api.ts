import { supabase } from '@/lib/supabase'
import type { Database, UserSettings } from '@/lib/database.types'

type SettingsUpdate = Database['public']['Tables']['user_settings']['Update']

export async function fetchUserSettings(userId: string): Promise<UserSettings | null> {
  const { data, error } = await supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data
}

export async function upsertUserSettings(userId: string, patch: SettingsUpdate): Promise<UserSettings> {
  const { data, error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
    .select('*')
    .single()
  if (error) throw error
  return data
}
