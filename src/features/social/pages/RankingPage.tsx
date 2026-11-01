import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { PageShell } from '@/components/layout/PageShell'
import { LeaderboardContent } from '@/features/leaderboard/pages/LeaderboardPage'
import { useSocialEnabled } from '../hooks'
import { BackLink } from '../components/parts'

/** /social/ranking (trophy in the Community header). Works without joining; members open social profiles. */
export function RankingPage() {
  const { t } = useTranslation('social')
  const navigate = useNavigate()
  const enabled = useSocialEnabled()
  return (
    <PageShell title={t('ranking.title')} leading={<BackLink title={t('ranking.title')} />}>
      <div className="mx-auto max-w-xl pb-6">
        <LeaderboardContent
          onOpenPerson={
            enabled ? (row) => navigate(`/social/u/${row.user_id}`, { state: { person: row } }) : undefined
          }
        />
      </div>
    </PageShell>
  )
}
