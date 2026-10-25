import { useTranslation } from 'react-i18next'
import { PageShell } from '@/components/layout/PageShell'
import { ComingSoon } from '@/components/layout/ComingSoon'
import { useAuth } from '@/features/auth/AuthProvider'
import { ScoreHeader } from '@/features/gamification/ScoreHeader'

export function DashboardPage({ preview }: { preview?: { points: number; streak: number } }) {
  const { t } = useTranslation('common')
  const { profile } = useAuth()
  const points = preview?.points ?? profile?.total_points ?? 0
  const streak = preview?.streak ?? profile?.current_streak ?? 0
  return (
    <PageShell title={t('nav.home')} leading={<ScoreHeader points={points} streak={streak} />}>
      <ComingSoon phase={4} />
    </PageShell>
  )
}
