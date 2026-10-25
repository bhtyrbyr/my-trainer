import { useTranslation } from 'react-i18next'
import { PageShell } from '@/components/layout/PageShell'
import { ComingSoon } from '@/components/layout/ComingSoon'
import { HeaderActions } from '@/components/layout/HeaderActions'

/** Weekly / monthly / all-time ranking from get_leaderboard() RPC (UI lands in Faz 1). */
export function LeaderboardPage() {
  const { t } = useTranslation('common')
  return (
    <PageShell title={t('nav.leaderboard')} actions={<HeaderActions />}>
      <ComingSoon phase={1} />
    </PageShell>
  )
}
