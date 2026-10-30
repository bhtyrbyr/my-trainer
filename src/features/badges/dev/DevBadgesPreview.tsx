// DEV ONLY (registered under /__dev/profile in router.tsx behind import.meta.env.DEV).
// Profile with a seeded badge shelf: three earned, the rest with progress. ?celebrate=sets_100 opens the
// celebration sheet; ?fresh=1 shows a shelf with nothing earned yet.
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from '@/app/AppShell'
import { AdminPreviewContext } from '@/features/admin/previewContext'
import { useAuth } from '@/features/auth/AuthProvider'
import { effectiveStreak } from '@/features/gamification/streak'
import { SettingsPage } from '@/features/settings/pages/SettingsPage'
import { BadgeCelebration } from '../components/BadgeCelebration'
import { badgeKeys } from '../hooks'
import { BADGES, type BadgeCode, type BadgeCounts, type EarnedBadge } from '../logic'
import { BadgesPreviewContext } from '../previewContext'

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

const SAMPLE_EARNED: EarnedBadge[] = [
  { badge_code: 'first_workout', earned_at: daysAgo(41) },
  { badge_code: 'streak_7', earned_at: daysAgo(30) },
  { badge_code: 'sets_100', earned_at: daysAgo(6) },
]

function seed(fresh: boolean): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnMount: false } },
  })
  const counts: BadgeCounts = fresh
    ? { workouts: 0, streak: 0, sets: 0, photos: 0, habitDays: 0, todos: 0 }
    : { workouts: 14, streak: 12, sets: 236, photos: 4, habitDays: 22, todos: 9 }
  qc.setQueryData(badgeKeys.mine, fresh ? [] : SAMPLE_EARNED)
  qc.setQueryData([...badgeKeys.counts, 0], counts)
  return qc
}

/** Layout route: sample cache + preview flags + the normal app frame (tab bar). */
export function DevProfileLayout() {
  const [params] = useSearchParams()
  const { profile } = useAuth()
  const [client] = useState(() => {
    const qc = seed(params.get('fresh') === '1')
    // the signed-in user's best streak keys the counts query
    const streak = Math.max(profile?.longest_streak ?? 0, effectiveStreak(profile?.current_streak, profile?.last_active_on))
    if (streak) qc.setQueryData([...badgeKeys.counts, streak], qc.getQueryData([...badgeKeys.counts, 0]))
    return qc
  })
  return (
    <QueryClientProvider client={client}>
      <AdminPreviewContext.Provider value={true}>
        <BadgesPreviewContext.Provider value={true}>
          <AppShell />
        </BadgesPreviewContext.Provider>
      </AdminPreviewContext.Provider>
    </QueryClientProvider>
  )
}

export function DevProfile() {
  const [params] = useSearchParams()
  const celebrate = params.get('celebrate')?.split(',') ?? []
  const codes = BADGES.map((b) => b.code).filter((c) => celebrate.includes(c)) as BadgeCode[]
  return (
    <>
      <SettingsPage />
      <BadgeCelebration preview={codes} />
    </>
  )
}
