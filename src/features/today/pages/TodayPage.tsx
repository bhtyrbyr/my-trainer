import { useTranslation } from 'react-i18next'
import { PageShell } from '@/components/layout/PageShell'
import { ComingSoon } from '@/components/layout/ComingSoon'

/** Habits + to-dos merged into one daily list (Faz 3). */
export function TodayPage() {
  const { t } = useTranslation('common')
  return (
    <PageShell title={t('nav.today')}>
      <ComingSoon phase={3} />
    </PageShell>
  )
}
