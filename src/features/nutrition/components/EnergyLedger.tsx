import { useTranslation } from 'react-i18next'
import { Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { remaining } from '../logic'
import type { Totals } from '../types'

type Props = {
  totals: Totals
  goalKcal: number | null
  goalProtein: number | null
  burned: { kcal: number; sessions: number } | undefined
  onGoals: () => void
}

/**
 * Point of view: a two-column ledger that never nets. Eaten is the main column (volt progress to
 * the goal); burned sits in its own narrower column, always marked as an estimate.
 */
export function EnergyLedger({ totals, goalKcal, goalProtein, burned, onGoals }: Props) {
  const { t, i18n } = useTranslation('nutrition')
  const nf = new Intl.NumberFormat(i18n.resolvedLanguage === 'en' ? 'en' : 'tr', { maximumFractionDigits: 0 })
  const left = remaining(goalKcal, totals.kcal)
  const pct = goalKcal ? Math.min(100, (totals.kcal / goalKcal) * 100) : 0
  const over = left !== null && left < 0

  return (
    <section className="hairline overflow-hidden rounded-[var(--radius-card)] bg-surface" aria-label={`${t('ledger.eaten')} / ${t('ledger.burned')}`}>
      <div className="grid grid-cols-[1.55fr_1fr]">
        <div className="p-5 pr-4">
          <p className="eyebrow">{t('ledger.eaten')}</p>
          <p className="mt-3 flex items-baseline gap-1.5">
            <span className="display tabular text-[48px] leading-[0.9] tracking-[-0.04em]">{nf.format(totals.kcal)}</span>
            <span className="text-[14px] font-medium text-ink-muted">{t('units.kcal')}</span>
          </p>
          {goalKcal ? (
            <>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
                <div className={cn('h-full rounded-full', over ? 'bg-ink-muted' : 'bg-volt')} style={{ width: `${pct}%` }} />
              </div>
              <p className="tabular mt-2 text-[12px] text-ink-muted">
                {t('ledger.goal', { kcal: nf.format(goalKcal) })}
                <span className="mx-1.5 text-ink-faint">·</span>
                <span className={over ? 'text-ink' : undefined}>
                  {over ? t('ledger.over', { kcal: nf.format(-left!) }) : t('ledger.left', { kcal: nf.format(left!) })}
                </span>
              </p>
            </>
          ) : (
            <button type="button" onClick={onGoals} className="mt-3 h-11 text-[13px] font-medium text-volt">
              {t('ledger.noGoal')}
            </button>
          )}
        </div>
        <div className="border-l border-line p-5 pl-4">
          <p className="eyebrow">{t('ledger.burned')}</p>
          <p className="mt-3 flex items-baseline gap-1">
            {burned && burned.sessions > 0 && <span className="text-[20px] text-ink-faint">≈</span>}
            <span className="display tabular text-[32px] leading-[0.9] tracking-[-0.03em] text-ink-muted">{nf.format(burned?.kcal ?? 0)}</span>
            <span className="text-[12px] font-medium text-ink-faint">{t('units.kcal')}</span>
          </p>
          <p className="mt-3 text-[11px] leading-snug text-ink-faint">{burned && burned.sessions > 0 ? t('ledger.burnedHint') : t('ledger.burnedNone')}</p>
        </div>
      </div>

      <div className="flex items-stretch border-t border-line">
        <dl className="grid flex-1 grid-cols-3 divide-x divide-line">
          <Macro label={t('ledger.protein')} value={totals.protein_g} goal={goalProtein} unit={t('units.g')} goalText={goalProtein ? t('ledger.ofGoal', { g: goalProtein }) : null} />
          <Macro label={t('ledger.carb')} value={totals.carb_g} unit={t('units.g')} />
          <Macro label={t('ledger.fat')} value={totals.fat_g} unit={t('units.g')} />
        </dl>
        <button
          type="button"
          onClick={onGoals}
          aria-label={t('ledger.editGoals')}
          className="flex w-12 shrink-0 items-center justify-center border-l border-line text-ink-faint hover:bg-raised hover:text-ink"
        >
          <Settings2 className="size-4" aria-hidden />
        </button>
      </div>
    </section>
  )
}

function Macro({ label, value, unit, goal, goalText }: { label: string; value: number; unit: string; goal?: number | null; goalText?: string | null }) {
  const { i18n } = useTranslation()
  const nf = new Intl.NumberFormat(i18n.resolvedLanguage === 'en' ? 'en' : 'tr', { maximumFractionDigits: 0 })
  const pct = goal ? Math.min(100, (value / goal) * 100) : null
  return (
    <div className="min-w-0 px-3.5 py-3">
      <dt className="truncate text-[11px] font-medium text-ink-faint">{label}</dt>
      <dd className="mt-1 truncate">
        <span className="tabular text-[17px] font-semibold">{nf.format(value)}</span>
        <span className="ml-0.5 text-[11px] text-ink-faint">{goalText ?? unit}</span>
      </dd>
      {pct !== null && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raised" aria-hidden>
          <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-volt' : 'bg-ink-muted')} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}
