import { useTranslation } from 'react-i18next'
import { PageShell } from '@/components/layout/PageShell'
import { ComingSoon } from '@/components/layout/ComingSoon'
import { HeaderActions } from '@/components/layout/HeaderActions'
import { useAuth } from '@/features/auth/AuthProvider'

export function DashboardPage() {
  const { t } = useTranslation('common')
  const { profile } = useAuth()
  return (
    <PageShell
      title={profile?.display_name ?? t('nav.home')}
      subtitle={profile ? `${t('points', { n: profile.total_points })} · ${t('streakDays', { n: profile.current_streak })}` : undefined}
      actions={<HeaderActions />}
    >
      <ComingSoon phase={4} />
    </PageShell>
  )
}
