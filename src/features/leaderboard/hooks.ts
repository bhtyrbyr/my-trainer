import { useQuery } from '@tanstack/react-query'
import { fetchLeaderboard, type LeaderboardPeriod } from './api'

export const leaderboardKeys = {
  period: (p: LeaderboardPeriod) => ['leaderboard', p] as const,
}

export function useLeaderboard(period: LeaderboardPeriod) {
  return useQuery({
    queryKey: leaderboardKeys.period(period),
    queryFn: () => fetchLeaderboard(period),
    staleTime: 30_000,
    refetchInterval: 120_000,
  })
}
