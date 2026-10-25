import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { addMonths, format, isSameMonth, startOfMonth } from 'date-fns'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { toLocalDateISO } from '@/lib/dates'
import { MonthCalendar } from '../components/MonthCalendar'
import { sessionTitle } from '../components/sessionTitle'
import { useDateLocale, useHistory, useWeightUnit } from '../hooks'
import { trainingDays } from '../logic'
import { useIsPreview } from '../previewContext'
import type { HistoryItem } from '../schema'

/**
 * History. Point of view: a training log book. The month is a quiet grid where only training days are
 * marked; below it, a ruled list where the date is set large on the left like a diary margin.
 */
export function HistoryPage() {
  const { t } = useTranslation('workouts')
  const locale = useDateLocale()
  const preview = useIsPreview()
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [day, setDay] = useState<string | null>(null)
  const next = addMonths(month, 1)
  const history = useHistory(format(month, 'yyyy-MM'), month, next)
  const w = useWeightUnit()

  const items = useMemo(() => history.data ?? [], [history.data])
  const marked = useMemo(() => trainingDays(items), [items])
  const visible = day ? items.filter((s) => toLocalDateISO(new Date(s.started_at)) === day) : items
  const strength = items.filter((s) => s.kind === 'strength')
  const volume = strength.reduce((sum, s) => sum + Number(s.total_volume_kg), 0)
  const isCurrent = isSameMonth(month, new Date())
  const shift = (n: number) => {
    setMonth((m) => addMonths(m, n))
    setDay(null)
  }

  return (
    <PageShell
      title={t('history.title')}
      leading={
        <div className="flex items-center gap-1">
          <Link
            to={preview ? '/__dev/workouts' : '/workouts'}
            aria-label={t('common.back')}
            className="-ml-2 flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <span className="text-lg font-bold tracking-tight">{t('history.title')}</span>
        </div>
      }
    >
      <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-10">
        <section aria-label={t('history.calendar')}>
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              aria-label={t('history.prevMonth')}
              onClick={() => shift(-1)}
              className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <h2 className="display text-[24px] capitalize">{format(month, 'LLLL yyyy', { locale })}</h2>
            <button
              type="button"
              aria-label={t('history.nextMonth')}
              disabled={isCurrent}
              onClick={() => shift(1)}
              className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink disabled:opacity-30"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </div>

          <MonthCalendar month={month} marked={marked} selected={day} onSelect={setDay} todayKey={toLocalDateISO()} />

          <dl className="mt-5 grid grid-cols-3 border-y border-line">
            <MonthStat label={t('history.sessions')} value={String(items.length)} />
            <MonthStat label={t('history.days')} value={String(marked.size)} border />
            <MonthStat label={t('history.volume', { unit: w.unit })} value={w.formatTotal(volume)} border />
          </dl>
        </section>

        <section className="mt-8 lg:mt-0" aria-label={t('history.list')}>
          <ErrorNote error={history.error} className="mb-3" />
          {day && (
            <button type="button" onClick={() => setDay(null)} className="mb-2 flex h-11 items-center px-1 text-sm font-medium text-volt">
              {t('history.showMonth')}
            </button>
          )}
          {history.isLoading ? (
            <div className="h-48 animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none" />
          ) : visible.length === 0 ? (
            <p className="px-1 py-10 text-center text-sm text-ink-faint">{t('history.empty')}</p>
          ) : (
            <ul className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
              {visible.map((s) => (
                <HistoryRow key={s.id} item={s} href={preview ? '/__dev/workouts/detail' : `/workouts/history/${s.id}`} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageShell>
  )
}

function MonthStat({ label, value, border }: { label: string; value: string; border?: boolean }) {
  return (
    <div className={border ? 'flex flex-col-reverse border-l border-line py-3.5 pl-4' : 'flex flex-col-reverse py-3.5 pr-2'}>
      <dt className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">{label}</dt>
      <dd className="display tabular text-[26px] leading-none">{value}</dd>
    </div>
  )
}

function HistoryRow({ item, href }: { item: HistoryItem; href: string }) {
  const { t } = useTranslation('workouts')
  const locale = useDateLocale()
  const w = useWeightUnit()
  const d = new Date(item.started_at)
  const minutes = Math.max(1, Math.round((item.duration_sec ?? 0) / 60))
  const distance = item.cardio.reduce((m, c) => m + (c.distance_m ?? 0), 0)
  const kcal = item.kcal_estimate != null ? t('energy.short', { kcal: w.formatNumber(item.kcal_estimate) }) : null
  const meta =
    item.kind === 'cardio'
      ? [t('units.minN', { n: minutes }), distance > 0 ? `${w.formatNumber(Math.round(distance / 100) / 10)} ${t('units.km')}` : null, kcal]
      : [t('units.minN', { n: minutes }), kcal, t('history.setsN', { count: item.total_sets }), `${w.formatTotal(Number(item.total_volume_kg))} ${w.unit}`]
  return (
    <li>
      <Link to={href} className="flex items-center gap-4 px-4 py-3.5 hover:bg-raised/50">
        <span className="w-10 shrink-0 text-center">
          <span className="display tabular block text-[24px] leading-none">{format(d, 'd')}</span>
          <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{format(d, 'EEE', { locale })}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{sessionTitle(item, t)}</span>
            {item.kind === 'cardio' && (
              <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                {t('history.cardioTag')}
              </span>
            )}
          </span>
          <span className="tabular block truncate text-[13px] text-ink-muted">{meta.filter(Boolean).join(' · ')}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
      </Link>
    </li>
  )
}
