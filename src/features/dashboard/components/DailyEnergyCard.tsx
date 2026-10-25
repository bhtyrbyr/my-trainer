import { useTranslation } from 'react-i18next'
import { useBurnedToday } from '@/features/workouts'

type Props = { preview?: { kcal: number; sessions: number } }

/**
 * Today's energy ledger. Step 1 shows what workouts burned; the nutrition module adds what was
 * eaten as a separate column. The two are never netted against each other (product decision).
 */
export function DailyEnergyCard({ preview }: Props) {
  const { t, i18n } = useTranslation('workouts')
  const burned = useBurnedToday(preview)
  const nf = new Intl.NumberFormat(i18n.language)

  if (burned.isLoading) {
    return <div className="h-[132px] animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none" aria-busy="true" />
  }
  if (burned.isError || !burned.data) return null

  const { kcal, sessions } = burned.data
  return (
    <section className="hairline rounded-[var(--radius-card)] bg-surface p-5" aria-label={t('energy.todayAria', { kcal })}>
      <p className="eyebrow">{t('energy.todayEyebrow')}</p>
      <p className="display tabular mt-3 text-[44px] leading-none tracking-[-0.03em]" aria-hidden>
        {sessions > 0 && <span className="mr-1.5 align-[0.12em] text-[0.6em] text-ink-faint">≈</span>}
        {nf.format(kcal)}
        <span className="ml-1.5 text-[17px] font-medium tracking-normal text-ink-muted">kcal</span>
      </p>
      <p className="mt-2.5 text-[13px] leading-snug text-ink-muted">
        {sessions > 0 ? t('energy.todaySessions', { count: sessions }) : t('energy.todayNone')}
      </p>
    </section>
  )
}
