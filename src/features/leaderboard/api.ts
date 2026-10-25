import { supabase } from '@/lib/supabase'
import type { LeaderboardRow } from '@/lib/database.types'

export type LeaderboardPeriod = 'week' | 'month' | 'all'

export async function fetchLeaderboard(period: LeaderboardPeriod, limit = 50): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc('get_leaderboard', { p_period: period, p_limit: limit })
  if (error) throw error
  return data ?? []
}
