import { supabase } from '@/lib/supabase'
import { BADGES, type BadgeCounts, type EarnedBadge } from './logic'

/** The caller's own badges (RLS: owner read). */
export async function fetchMyBadges(): Promise<EarnedBadge[]> {
  const { data, error } = await supabase
    .from('user_badges')
    .select('badge_code, earned_at')
    .order('earned_at')
  if (error) throw error
  return data ?? []
}

/**
 * Someone's badges for the public profile sheet. The server returns rows only for approved, visible
 * (leaderboard) users or the caller; anyone else simply has none.
 */
export async function fetchUserBadges(userId: string): Promise<EarnedBadge[]> {
  const { data, error } = await supabase.rpc('get_user_badges', { p_user: userId })
  if (error) throw error
  return data ?? []
}

/**
 * Totals behind the locked badges' progress for the caller (my_badge_progress: the same metric function
 * the server awards with, so the shelf and the award always agree). Unknown metrics read as 0.
 */
export async function fetchBadgeCounts(): Promise<BadgeCounts> {
  const { data, error } = await supabase.rpc('my_badge_progress')
  if (error) throw error
  const raw = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>
  return Object.fromEntries(BADGES.map((b) => [b.metric, Number(raw[b.metric]) || 0])) as BadgeCounts
}
