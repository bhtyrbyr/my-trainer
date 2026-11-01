import { supabase } from '@/lib/supabase'
import type { Database, Profile } from '@/lib/database.types'
import type { OnboardingValues, ProfileEditValues } from './schema'

export const AVATAR_BUCKET = 'avatars'

export function avatarUrl(path: string | null | undefined, cacheKey?: string | null): string | null {
  if (!path) return null
  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path)
  return cacheKey ? `${data.publicUrl}?v=${encodeURIComponent(cacheKey)}` : data.publicUrl
}

/**
 * Server-side check (profiles are readable only by their owner): true when nobody else holds the name.
 * The caller's own current username counts as available; `_selfUserId` is kept for call-site compatibility.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function isUsernameAvailable(username: string, _selfUserId?: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_username_available', { p_username: username })
  if (error) throw error
  return data === true
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

/**
 * Order matters: once the public profile exists the account is "pending" and can_access() denies
 * every other table, so private details are written FIRST (while no profile exists yet).
 * Both writes are upserts so a half-finished onboarding can simply be retried.
 */
export async function completeOnboarding(userId: string, avatarPath: string, v: OnboardingValues): Promise<Profile> {
  const priv: Database['public']['Tables']['profile_private']['Insert'] = {
    user_id: userId,
    birth_year: v.birthYear === '' || v.birthYear === undefined ? null : v.birthYear,
    height_cm: v.heightCm === '' || v.heightCm === undefined ? null : v.heightCm,
    start_weight_kg: v.weightKg === '' || v.weightKg === undefined ? null : v.weightKg,
    sex: v.sex ? v.sex : null,
    goal: v.goal ? v.goal : null,
  }
  const { error: privErr } = await supabase.from('profile_private').upsert(priv, { onConflict: 'user_id' })
  // A pending account retrying after a partial failure cannot touch profile_private any more; that is fine,
  // the row was written on the first attempt. Any other error is real.
  if (privErr && privErr.code !== '42501') throw privErr

  const profileRow: Database['public']['Tables']['profiles']['Insert'] = {
    user_id: userId,
    username: v.username,
    display_name: v.displayName,
    avatar_path: avatarPath,
    show_on_leaderboard: v.showOnLeaderboard,
    onboarding_completed_at: new Date().toISOString(),
  }
  const { data: profile, error } = await supabase
    .from('profiles')
    .upsert(profileRow, { onConflict: 'user_id' })
    .select('*')
    .single()
  if (error) throw error
  return profile
}

// -----------------------------------------------------------------------------
// Profile edit (/me/edit). RLS: owners update their own profiles row (the protect trigger freezes
// points, role, status and enforces the 30-day username rule) and their own profile_private row.
// -----------------------------------------------------------------------------

export type ProfilePrivate = {
  birth_year: number | null
  height_cm: number | null
  sex: 'male' | 'female' | 'other' | null
  goal: 'lose_fat' | 'build_muscle' | 'maintain' | 'performance' | null
  target_weight_kg: number | null
}

export async function getProfilePrivate(): Promise<ProfilePrivate> {
  const { data, error } = await supabase
    .from('profile_private')
    .select('birth_year, height_cm, sex, goal, target_weight_kg')
    .maybeSingle()
  if (error) throw error
  const num = (v: number | string | null | undefined) => (v == null ? null : Number(v))
  return {
    birth_year: num(data?.birth_year),
    height_cm: num(data?.height_cm),
    sex: data?.sex ?? null,
    goal: data?.goal ?? null,
    target_weight_kg: num(data?.target_weight_kg),
  }
}

export async function setAvatarPath(userId: string, path: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ avatar_path: path }).eq('user_id', userId)
  if (error) throw error
}

/** Only for a legacy object at another path (e.g. avatar.webp); avatar.jpg itself is overwritten. */
export async function removeAvatar(path: string): Promise<void> {
  const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([path])
  if (error) throw error
}

const orNull = <T,>(v: T | '' | undefined): T | null => (v === '' || v === undefined ? null : v)

export async function saveProfileEdit(
  userId: string,
  v: ProfileEditValues,
  opts: { usernameChanged: boolean },
): Promise<void> {
  // private details first: if the public update fails (e.g. username taken) nothing public changed
  const { error: privErr } = await supabase.from('profile_private').upsert(
    {
      user_id: userId,
      birth_year: orNull(v.birthYear),
      height_cm: orNull(v.heightCm),
      target_weight_kg: orNull(v.targetWeightKg),
      sex: v.sex || null,
      goal: v.goal || null,
    },
    { onConflict: 'user_id' },
  )
  if (privErr) throw privErr

  const patch: Database['public']['Tables']['profiles']['Update'] = { display_name: v.displayName }
  // only send the username when it changed: the trigger stamps username_changed_at on any change
  if (opts.usernameChanged) patch.username = v.username
  const { error } = await supabase.from('profiles').update(patch).eq('user_id', userId)
  if (error) throw error
}

export async function setLeaderboardVisibility(userId: string, visible: boolean): Promise<void> {
  const { error } = await supabase.from('profiles').update({ show_on_leaderboard: visible }).eq('user_id', userId)
  if (error) throw error
}
