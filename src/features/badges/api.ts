import { supabase } from '@/lib/supabase'
import type { BadgeCounts, EarnedBadge } from './logic'

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
 * Totals behind the locked badges' progress, from the caller's own rows (RLS). Streak comes from the
 * profile. Photos are health data: without consent RLS returns none and the count is simply 0.
 */
export async function fetchBadgeCounts(streak: number): Promise<BadgeCounts> {
  const [workouts, sets, photos, habits, todos] = await Promise.all([
    supabase
      .from('workout_sessions')
      .select('id', { count: 'exact', head: true })
      .not('ended_at', 'is', null),
    supabase.from('workout_sessions').select('total_sets').not('ended_at', 'is', null),
    supabase.from('progress_photos').select('id', { count: 'exact', head: true }),
    supabase.from('habit_logs').select('count, habits!inner(target_count)'),
    supabase.from('todo_completions').select('id', { count: 'exact', head: true }),
  ])
  for (const r of [workouts, sets, photos, habits, todos]) if (r.error) throw r.error
  return {
    workouts: workouts.count ?? 0,
    sets: (sets.data ?? []).reduce((s, r) => s + (r.total_sets ?? 0), 0),
    streak,
    photos: photos.count ?? 0,
    habitDays: (habits.data ?? []).filter((l) => l.count >= (l.habits?.target_count ?? Infinity)).length,
    todos: todos.count ?? 0,
  }
}
