import { useTranslation } from 'react-i18next'
import { PageShell } from '@/components/layout/PageShell'
import { ComingSoon } from '@/components/layout/ComingSoon'

export function WorkoutsPage() {
  const { t } = useTranslation('common')
  return (
    <PageShell title={t('nav.workouts')}>
      <ComingSoon phase={1} />
    </PageShell>
  )
}
