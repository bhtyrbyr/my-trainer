import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { ChevronRight, Droplet, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { cn } from '@/lib/utils'
import { useAddWater, useDeleteWater, useWater } from '../hooks'
import { waterTotal } from '../logic'
import { WATER_QUICK } from '../types'

/**
 * Water: the day's total against the goal, three one-tap amounts sized for real vessels, another
 * amount, and the list of drinks (each removable).
 */
export function WaterCard({ day, goal, onGoal }: { day: string; goal: number; onGoal: () => void }) {
  const { t, i18n } = useTranslation('sleepwater')
  const nf = new Intl.NumberFormat(i18n.resolvedLanguage === 'en' ? 'en' : 'tr')
  const water = useWater(day)
  const add = useAddWater()
  const del = useDeleteWater()
  const [custom, setCustom] = useState('')
  const rows = water.data ?? []
  const total = waterTotal(rows)
  const pct = Math.min(100, (total / goal) * 100)
  const reached = total >= goal
  const customMl = Math.round(Number(custom.replace(/\D/g, '')) || 0)

  return (
    <section aria-labelledby="water-title" className="hairline overflow-hidden rounded-[var(--radius-card)] bg-surface">
      <div className="p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="water-title" className="eyebrow">
            {t('water.title')}
          </h2>
          <button type="button" onClick={onGoal} aria-label={t('water.editGoal')} className="-mr-2 flex h-11 items-center gap-1 rounded-full px-2 text-[13px] text-ink-muted hover:bg-raised hover:text-ink">
            {t('water.goal', { ml: nf.format(goal) })}
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
        <p className="mt-2 flex items-baseline gap-1.5">
          <span className="display tabular text-[48px] leading-[0.9] tracking-[-0.04em]">{nf.format(total)}</span>
          <span className="text-[15px] font-medium text-ink-muted">{t('water.of', { goal: nf.format(goal) })}</span>
        </p>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={total}>
          <div className="h-full rounded-full bg-volt transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <p className={cn('tabular mt-2 text-[13px]', reached ? 'font-semibold text-volt' : 'text-ink-muted')}>
          {reached ? t('water.reached') : t('water.left', { ml: nf.format(goal - total) })}
        </p>

        <div className="mt-5 grid grid-cols-3 gap-2">
          {WATER_QUICK.map((ml) => (
            <button
              key={ml}
              type="button"
              disabled={add.isPending}
              onClick={() => add.mutate({ day, ml })}
              aria-label={t('water.add', { ml })}
              className="hairline flex h-20 flex-col items-center justify-center gap-1 rounded-[var(--radius-button)] bg-bg transition-[transform,background-color] duration-150 hover:bg-raised active:scale-[0.97] disabled:opacity-60"
            >
              <span className="flex items-center gap-1 text-[17px] font-semibold">
                <Droplet className="size-4 text-volt" aria-hidden />+{ml}
              </span>
              <span className="text-[11px] text-ink-faint">{t(`water.quick.${ml}`)}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <label className="hairline flex h-11 flex-1 items-center rounded-[var(--radius-input)] bg-bg px-3 focus-within:ring-2 focus-within:ring-volt">
            <span className="sr-only">{t('water.custom')}</span>
            <input
              inputMode="numeric"
              enterKeyHint="done"
              placeholder={t('water.custom')}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="tabular w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-faint"
            />
            <span className="text-[12px] text-ink-faint">{t('water.unit')}</span>
          </label>
          <Button
            variant="secondary"
            className="h-11"
            disabled={customMl < 10 || customMl > 3000 || add.isPending}
            onClick={() => add.mutate({ day, ml: customMl }, { onSuccess: () => setCustom('') })}
          >
            {add.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : t('water.customAdd')}
          </Button>
        </div>
        <ErrorNote error={water.error ?? add.error ?? del.error} className="mt-3" />
      </div>

      <div className="border-t border-line">
        {rows.length === 0 ? (
          <p className="px-5 py-3.5 text-[13px] text-ink-faint">{t('water.none')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {[...rows].reverse().map((r) => (
              <li key={r.id} className="flex h-11 items-center gap-3 pl-5 pr-2">
                <span className="tabular w-12 text-[13px] text-ink-faint">{format(new Date(r.logged_at), 'HH:mm')}</span>
                <span className="tabular flex-1 text-[14px] font-medium">{t('water.amount', { ml: nf.format(r.amount_ml) })}</span>
                <button
                  type="button"
                  aria-label={t('water.remove', { ml: r.amount_ml })}
                  onClick={() => del.mutate({ id: r.id, day })}
                  className="flex size-11 items-center justify-center rounded-full text-ink-faint hover:bg-raised hover:text-ink"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-line px-5 py-2.5 text-[11px] text-ink-faint">{t('water.points')}</p>
      </div>
    </section>
  )
}
