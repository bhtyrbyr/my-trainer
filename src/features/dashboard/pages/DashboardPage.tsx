import { useTranslation } from 'react-i18next'
import { PageShell } from '@/components/layout/PageShell'
import { ComingSoon } from '@/components/layout/ComingSoon'
import { useAuth } from '@/features/auth/AuthProvider'
import { ScoreHeader } from '@/features/gamification/ScoreHeader'
import { effectiveStreak } from '@/features/gamification/streak'

export function DashboardPage({ preview }: { preview?: { points: number; streak: number } }) {
  const { t } = useTranslation('common')
  const { profile } = useAuth()
  const points = preview?.points ?? profile?.total_points ?? 0
  const streak = preview?.streak ?? effectiveStreak(profile?.current_streak, profile?.last_active_on)
  return (
    <PageShell title={t('nav.home')} leading={<ScoreHeader points={points} streak={streak} />}>
      <ComingSoon phase={4} />
    </PageShell>
  )
}
