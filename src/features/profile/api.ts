import { supabase } from '@/lib/supabase'
import type { Database, Profile } from '@/lib/database.types'
import type { OnboardingValues } from './schema'

export const AVATAR_BUCKET = 'avatars'

export function avatarUrl(path: string | null | undefined, cacheKey?: string | null): string | null {
  if (!path) return null
  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path)
  return cacheKey ? `${data.publicUrl}?v=${encodeURIComponent(cacheKey)}` : data.publicUrl
}

export async function isUsernameAvailable(username: string, selfUserId?: string): Promise<boolean> {
  const { data, error } = await supabase.from('profiles').select('user_id').eq('username', username).limit(1)
  if (error) throw error
  if (!data?.length) return true
  return Boolean(selfUserId) && data[0]!.user_id === selfUserId
}

export async function uploadAvatar(userId: string, blob: Blob): Promise<string> {
  const path = `${userId}/avatar.jpg`
  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: 'image/jpeg',
    cacheControl: '3600',
  })
  if (error) throw error
  return path
}

export async function completeOnboarding(userId: string, avatarPath: string, v: OnboardingValues): Promise<Profile> {
  const profileInsert: Database['public']['Tables']['profiles']['Insert'] = {
    user_id: userId,
    username: v.username,
    display_name: v.displayName,
    avatar_path: avatarPath,
    show_on_leaderboard: v.showOnLeaderboard,
    onboarding_completed_at: new Date().toISOString(),
  }
  const { data: profile, error } = await supabase.from('profiles').insert(profileInsert).select('*').single()
  if (error) throw error

  const priv: Database['public']['Tables']['profile_private']['Insert'] = {
    user_id: userId,
    birth_year: v.birthYear === '' || v.birthYear === undefined ? null : v.birthYear,
    height_cm: v.heightCm === '' || v.heightCm === undefined ? null : v.heightCm,
    sex: v.sex ? v.sex : null,
    goal: v.goal ? v.goal : null,
  }
  const { error: privErr } = await supabase.from('profile_private').upsert(priv, { onConflict: 'user_id' })
  if (privErr) throw privErr

  return profile
}
