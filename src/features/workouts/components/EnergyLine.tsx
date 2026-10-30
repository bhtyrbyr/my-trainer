import { useTranslation } from 'react-i18next'
import { useUnits } from '@/features/settings/useUnits'
import { cn } from '@/lib/utils'

/** what the server assumes without a weigh-in (supabase/migrations/*_exercise_energy.sql) */
const ASSUMED_WEIGHT_KG = 70

type Props = {
  kcal: number | null | undefined
  /** body weight the server used; null when it assumed the 70 kg default */
  weightKg: number | null | undefined
  className?: string
}

/**
 * Estimated energy of one session, as a ledger row under the session scoreboard.
 * Always marked as an estimate (≈) and kept apart from eaten calories by design.
 */
export function EnergyLine({ kcal, weightKg, className }: Props) {
  const { t, i18n } = useTranslation('workouts')
  const u = useUnits()
  if (kcal == null) return null
  // a sentence, so no forced trailing ",0"; the reading keeps its body-weight rounding
  const weight = (kg: number) => `${u.estimateValue(u.kg(kg, 'body'))} ${u.weightLabel}`
  const nf = new Intl.NumberFormat(i18n.language)
  return (
    <div className={cn('border-b border-line py-4', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">{t('energy.label')}</span>
        <span className="display tabular text-[30px] leading-none">
          <span className="mr-1.5 align-[0.12em] text-[0.6em] text-ink-faint">≈</span>
          {nf.format(kcal)}
          <span className="ml-1 text-[15px] font-medium tracking-normal text-ink-muted">kcal</span>
        </span>
      </div>
      <p className="mt-2 text-[12px] leading-snug text-ink-faint">
        {weightKg != null ? t('energy.basis', { weight: weight(weightKg) }) : t('energy.assumedWeight', { weight: `${u.estimate(ASSUMED_WEIGHT_KG)} ${u.weightLabel}` })}
      </p>
    </div>
  )
}
