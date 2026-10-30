import { supabase } from '@/lib/supabase'
import { LEGAL } from '@/config/brand'
import { PHOTO_BUCKET } from '@/features/photos/api'
import { AVATAR_BUCKET } from '@/features/profile/api'

export type ConsentRow = { kind: 'privacy_notice' | 'health_data'; version: string; granted: boolean; created_at: string }

/** The caller's consent log, newest first (RLS: own rows only). */
export async function listConsents(): Promise<ConsentRow[]> {
  const { data, error } = await supabase.from('user_consents').select('kind, version, granted, created_at').order('id', { ascending: false })
  if (error) throw error
  return (data ?? []) as ConsentRow[]
}

export async function acknowledgeNotice(): Promise<void> {
  const { error } = await supabase.rpc('record_consent', { p_kind: 'privacy_notice', p_version: LEGAL.noticeVersion })
  if (error) throw error
}

export async function grantHealthConsent(): Promise<void> {
  const { error } = await supabase.rpc('record_consent', { p_kind: 'health_data', p_version: LEGAL.healthConsentVersion })
  if (error) throw error
}

/** Every object in the caller's own folder of a bucket (owner select policies). */
async function ownObjects(bucket: string, userId: string): Promise<string[]> {
  const out: string[] = []
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.storage.from(bucket).list(userId, { limit: 100, offset })
    if (error) throw error
    out.push(...(data ?? []).filter((o) => o.id).map((o) => `${userId}/${o.name}`))
    if (!data || data.length < 100) return out
  }
}

async function removeOwnObjects(bucket: string, userId: string): Promise<void> {
  const paths = await ownObjects(bucket, userId)
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await supabase.storage.from(bucket).remove(paths.slice(i, i + 100))
    if (error) throw error
  }
}

/** Withdraw: the server logs it and erases the rows; then the encrypted photo files go too. */
export async function withdrawHealthConsent(userId: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_health_consent', { p_version: LEGAL.healthConsentVersion })
  if (error) throw error
  await removeOwnObjects(PHOTO_BUCKET, userId)
}

/**
 * Files first (Supabase only deletes storage objects through the Storage API), then the account; the
 * auth user's deletion cascades through every table.
 */
export async function deleteMyAccount(userId: string): Promise<void> {
  await removeOwnObjects(PHOTO_BUCKET, userId)
  await removeOwnObjects(AVATAR_BUCKET, userId)
  const { error } = await supabase.rpc('delete_my_account')
  if (error) throw error
}

// Tables readable by their owner. profiles and exercises are partly shared (public profile columns,
// the exercise catalog), so those two are narrowed to the caller's own rows.
const OWN_TABLES = [
  'profile_private', 'user_settings', 'user_consents', 'workout_templates', 'template_exercises', 'workout_sessions',
  'session_exercises', 'session_sets', 'cardio_entries', 'personal_records', 'body_metrics', 'foods', 'meal_entries',
  'sleep_entries', 'water_entries', 'progress_photos', 'point_events', 'ai_usage', 'habits', 'habit_logs', 'todos', 'todo_completions',
] as const

/** KVKK art. 11: everything we hold about the caller, as one JSON document. */
export async function exportMyData(userId: string): Promise<Blob> {
  const data: Record<string, unknown> = {}
  const { data: profile, error: pErr } = await supabase.from('profiles').select('*').eq('user_id', userId)
  if (pErr) throw pErr
  data.profiles = profile
  const { data: custom, error: eErr } = await supabase.from('exercises').select('*').eq('user_id', userId)
  if (eErr) throw eErr
  data.exercises = custom
  for (const table of OWN_TABLES) {
    const { data: rows, error } = await supabase.from(table).select('*')
    if (error) throw error
    data[table] = rows
  }
  const doc = {
    exported_at: new Date().toISOString(),
    note: 'progress_photos lists encrypted photo records only; the images stay end-to-end encrypted and are not included.',
    data,
  }
  return new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
}
