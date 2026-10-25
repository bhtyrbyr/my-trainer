import { useTranslation } from 'react-i18next'
import { PageShell } from '@/components/layout/PageShell'
import { ComingSoon } from '@/components/layout/ComingSoon'

/** Body metrics, nutrition, sleep/water and progress photos live under this tab (Faz 2). */
export function TrackPage() {
  const { t } = useTranslation('common')
  return (
    <PageShell title={t('nav.track')}>
      <ComingSoon phase={2} />
    </PageShell>
  )
}
