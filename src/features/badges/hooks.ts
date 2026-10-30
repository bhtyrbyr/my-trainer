import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { format, parseISO } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { useAuth } from '@/features/auth/AuthProvider'
import { effectiveStreak } from '@/features/gamification/streak'
import { fetchBadgeCounts, fetchMyBadges, fetchUserBadges } from './api'
import { useIsBadgesPreview } from './previewContext'

export const badgeKeys = {
  all: ['badges'] as const,
  mine: ['badges', 'mine'] as const,
  counts: ['badges', 'counts'] as const,
  user: (userId: string) => ['badges', 'user', userId] as const,
}

export function useMyBadges() {
  const { user } = useAuth()
  const preview = useIsBadgesPreview()
  return useQuery({
    queryKey: badgeKeys.mine,
    queryFn: fetchMyBadges,
    enabled: Boolean(user) && !preview,
    staleTime: 30_000,
  })
}

/** Progress totals for the locked badges on the own shelf. */
export function useBadgeCounts() {
  const { user, profile } = useAuth()
  const preview = useIsBadgesPreview()
  const streak = Math.max(
    profile?.longest_streak ?? 0,
    effectiveStreak(profile?.current_streak, profile?.last_active_on),
  )
  return useQuery({
    queryKey: [...badgeKeys.counts, streak],
    queryFn: () => fetchBadgeCounts(streak),
    enabled: Boolean(user) && !preview,
    staleTime: 60_000,
  })
}

export function useUserBadges(userId: string | null) {
  const preview = useIsBadgesPreview()
  return useQuery({
    queryKey: badgeKeys.user(userId ?? ''),
    queryFn: () => fetchUserBadges(userId!),
    enabled: Boolean(userId) && !preview,
    staleTime: 5 * 60_000,
  })
}

/** Earned-date formatter in the UI language ("28 Eki" / "Oct 28"). */
export function useBadgeDate() {
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage === 'en' ? enUS : tr
  return useCallback((iso: string, pattern = 'd MMM') => format(parseISO(iso), pattern, { locale }), [locale])
}
