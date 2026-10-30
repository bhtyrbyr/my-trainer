import { useTranslation } from 'react-i18next'
import { format, parseISO } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { splitDuration } from '@/features/sleepwater'
import { useUnits } from '@/features/settings/useUnits'
import { addDays } from '@/lib/recurrence'
import { toLocalDateISO } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useWeekSummary } from '../hooks'
import { statGrid, weekStartOf, weekStats, type WeekStat } from '../logic'
import type { WeekSummary as Summary } from '../schema'

/**
 * This week. Point of view: a scoreboard line, not a tile wall. One big number (workouts) with its
 * substance underneath (sets, volume, cardio) and the change against last week; the rest of the week
 * (habits, to-dos, and with health consent sleep, weight, water) sits in one ruled supporting row.
 */
export function WeekSummary() {
  const { t, i18n } = useTranslation('dashboard')
  const locale = i18n.resolvedLanguage === 'en' ? enUS : tr
  const week = useWeekSummary(0)
  const last = useWeekSummary(-1)
  const start = weekStartOf(toLocalDateISO())
  const range = t('week.range', {
    from: format(parseISO(start), 'd MMM', { locale }),
    to: format(parseISO(addDays(start, 6)), 'd MMM', { locale }),
  })

  return (
    <section aria-labelledby="week-title" className="space-y-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 id="week-title" className="eyebrow">
          {t('week.title')}
        </h2>
        <span className="tabular text-[12px] text-ink-faint">{range}</span>
      </div>
      <ErrorNote error={week.error} />
      {week.isLoading ? (
        <div
          className="hairline h-[212px] animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none"
          aria-busy="true"
        />
      ) : week.data ? (
        <Card s={week.data} previous={last.data?.workouts ?? null} />
      ) : null}
    </section>
  )
}

function Card({ s, previous }: { s: Summary; previous: number | null }) {
  const { t } = useTranslation('dashboard')
  const u = useUnits()
  const detail = [
    s.sets > 0 && t('week.sets', { count: s.sets }),
    s.volume_kg > 0 && t('week.volume', { value: u.volume(s.volume_kg), unit: u.weightLabel }),
    s.cardio_minutes > 0 && t('week.cardio', { n: s.cardio_minutes }),
  ].filter(Boolean) as string[]
  const stats = weekStats(s)
  const grid = statGrid(stats.length)
  const delta = previous === null ? null : s.workouts - previous

  return (
    <div className="hairline overflow-hidden rounded-[var(--radius-card)] bg-surface">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="flex items-baseline gap-2.5">
            <span className="display tabular text-[64px] leading-[0.82]">{s.workouts}</span>
            <span className="text-[15px] font-medium text-ink-muted">
              {t('week.workouts', { count: s.workouts })}
            </span>
          </p>
          {delta !== null && <Delta n={delta} />}
        </div>
        <p className="tabular mt-3 text-[13px] text-ink-muted">
          {s.workouts === 0 ? t('week.empty') : detail.join(' · ')}
        </p>
      </div>
      {stats.length > 0 && (
        <dl
          className="grid border-t border-line"
          style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` }}
        >
          {stats.map((st, i) => (
            <div
              key={st.key}
              style={{ gridColumn: `span ${grid.spans[i]} / span ${grid.spans[i]}` }}
              className={cn(
                'min-w-0 px-4 py-3',
                i % grid.cols !== 0 && 'border-l border-line',
                i >= grid.cols && 'border-t border-line',
              )}
            >
              <Stat stat={st} />
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

function Delta({ n }: { n: number }) {
  const { t } = useTranslation('dashboard')
  const Icon = n > 0 ? ArrowUpRight : n < 0 ? ArrowDownRight : Minus
  const label =
    n > 0 ? t('week.deltaUp', { n }) : n < 0 ? t('week.deltaDown', { n: -n }) : t('week.deltaSame')
  return (
    <span className="mt-1 flex shrink-0 items-center gap-1 text-[12px] text-ink-muted">
      <Icon className="size-3.5" aria-hidden />
      <span className="tabular">{label}</span>
    </span>
  )
}

function Stat({ stat }: { stat: WeekStat }) {
  const { t, i18n } = useTranslation(['dashboard', 'sleepwater'])
  const u = useUnits()
  const pct = new Intl.NumberFormat(i18n.resolvedLanguage === 'en' ? 'en' : 'tr', {
    style: 'percent',
    maximumFractionDigits: 0,
  })
  let value: string
  switch (stat.key) {
    case 'habits':
      value = pct.format(stat.rate)
      break
    case 'todos':
      value = String(stat.count)
      break
    case 'sleep':
      value = t('sleepwater:sleep.duration', splitDuration(stat.minutes))
      break
    case 'weight':
      value = `${u.signed(u.weightDelta(stat.kg))} ${u.weightLabel}`
      break
    case 'water':
      value = String(stat.days)
      break
  }
  return (
    <>
      <dt className="eyebrow truncate">{t(`dashboard:week.stat.${stat.key}`)}</dt>
      <dd className="tabular mt-1 truncate text-[16px] font-semibold leading-tight">{value}</dd>
      <dd className="mt-0.5 truncate text-[11px] text-ink-faint">
        {t(`dashboard:week.stat.${stat.key}Caption`)}
      </dd>
    </>
  )
}
