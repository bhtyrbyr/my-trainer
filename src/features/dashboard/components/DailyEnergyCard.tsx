import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { useEatenOn } from '@/features/nutrition'
import { useBurnedToday } from '@/features/workouts'

type Props = { preview?: { burned: { kcal: number; sessions: number }; eaten: { kcal: number; entries: number } } }

/**
 * Today's energy ledger: eaten and burned in two columns that are never netted (product decision).
 * Burned is always an estimate (≈). The whole card opens the nutrition day.
 */
export function DailyEnergyCard({ preview }: Props) {
  const { t, i18n } = useTranslation('nutrition')
  const burned = useBurnedToday(preview?.burned)
  const eaten = useEatenOn(undefined, preview?.eaten)
  const nf = new Intl.NumberFormat(i18n.resolvedLanguage === 'en' ? 'en' : 'tr')

  if (burned.isLoading || eaten.isLoading) {
    return <div className="h-[132px] animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none" aria-busy="true" />
  }
  const b = burned.data ?? { kcal: 0, sessions: 0 }
  const e = eaten.data ?? { kcal: 0, entries: 0 }

  return (
    <Link
      to={preview ? '/__dev/track/nutrition' : '/track/nutrition'}
      aria-label={`${t('ledger.eaten')} ${nf.format(e.kcal)} kcal, ${t('ledger.burned')} ${nf.format(b.kcal)} kcal`}
      className="hairline group grid grid-cols-[1fr_1fr_auto] items-stretch overflow-hidden rounded-[var(--radius-card)] bg-surface"
    >
      <div className="p-5 pr-3">
        <p className="eyebrow">{t('ledger.eaten')}</p>
        <p className="mt-3 flex items-baseline gap-1">
          <span className="display tabular text-[36px] leading-none tracking-[-0.03em]">{nf.format(e.kcal)}</span>
          <span className="text-[13px] font-medium text-ink-muted">{t('units.kcal')}</span>
        </p>
        <p className="mt-2 text-[12px] text-ink-muted">{e.entries > 0 ? t('ledger.entries', { count: e.entries }) : t('add')}</p>
      </div>
      <div className="border-l border-line p-5 pl-4 pr-3">
        <p className="eyebrow">{t('ledger.burned')}</p>
        <p className="mt-3 flex items-baseline gap-1">
          {b.sessions > 0 && <span className="text-[18px] text-ink-faint">≈</span>}
          <span className="display tabular text-[36px] leading-none tracking-[-0.03em] text-ink-muted">{nf.format(b.kcal)}</span>
          <span className="text-[13px] font-medium text-ink-faint">{t('units.kcal')}</span>
        </p>
        <p className="mt-2 text-[12px] text-ink-faint">{b.sessions > 0 ? t('ledger.burnedShort') : t('ledger.burnedNone')}</p>
      </div>
      <span className="flex items-center pr-3 text-ink-faint group-hover:text-ink" aria-hidden>
        <ChevronRight className="size-4" />
      </span>
    </Link>
  )
}
