import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, parseISO, startOfMonth, startOfWeek } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useBodyMetrics } from '@/features/body'
import { useMealDays } from '@/features/nutrition'
import { useHistory } from '@/features/workouts'
import { toLocalDateISO } from '@/lib/dates'
import { cn } from '@/lib/utils'

type Props = { open: boolean; value: string; onPick: (day: string) => void; onClose: () => void }

/**
 * Month picker for the Track day. Every past day can be chosen; days with any record (meal,
 * workout, weigh-in) carry a volt dot, so the calendar doubles as a "where did I log" overview.
 */
export function DayPickerSheet({ open, value, onPick, onClose }: Props) {
  const { t, i18n } = useTranslation('track')
  const locale = i18n.resolvedLanguage === 'en' ? enUS : tr
  const [month, setMonth] = useState(() => startOfMonth(parseISO(value)))
  const today = toLocalDateISO()

  useEffect(() => {
    if (open) setMonth(startOfMonth(parseISO(value)))
  }, [open, value])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const from = toLocalDateISO(startOfMonth(month))
  const to = toLocalDateISO(endOfMonth(month))
  const meals = useMealDays(from, to)
  const sessions = useHistory(format(month, 'yyyy-MM'), startOfMonth(month), addMonths(startOfMonth(month), 1))
  const body = useBodyMetrics()
  const marked = useMemo(() => {
    const s = new Set<string>(meals.data ?? [])
    for (const x of sessions.data ?? []) s.add(toLocalDateISO(new Date(x.started_at)))
    for (const b of body.data ?? []) if (b.measured_on >= from && b.measured_on <= to) s.add(b.measured_on)
    return s
  }, [meals.data, sessions.data, body.data, from, to])

  const cells = useMemo(
    () => eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) }),
    [month],
  )
  const weekdays = useMemo(() => {
    const start = startOfWeek(new Date(2026, 0, 5), { weekStartsOn: 1 })
    return Array.from({ length: 7 }, (_, i) => format(addDays(start, i), 'EEEEEE', { locale }))
  }, [locale])

  if (!open) return null
  const canNext = format(addMonths(month, 1), 'yyyy-MM') <= today.slice(0, 7)

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center lg:items-center" role="presentation">
      <button type="button" aria-label={t('calendar.close')} className="absolute inset-0 bg-bg/70 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={t('calendar.title')} className="rise-in hairline relative w-full max-w-md rounded-t-[var(--radius-sheet)] bg-surface px-4 pb-safe pt-5 lg:rounded-[var(--radius-sheet)] lg:pb-4">
        <div className="mb-3 flex items-center justify-between">
          <button type="button" aria-label={t('calendar.prevMonth')} onClick={() => setMonth((m) => addMonths(m, -1))} className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink">
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <h2 className="display text-[22px] capitalize">{format(month, 'LLLL yyyy', { locale })}</h2>
          <button
            type="button"
            aria-label={t('calendar.nextMonth')}
            disabled={!canNext}
            onClick={() => setMonth((m) => addMonths(m, 1))}
            className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink disabled:opacity-30"
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
        <div role="grid" aria-label={format(month, 'LLLL yyyy', { locale })} className="pb-4">
          <div role="row" className="grid grid-cols-7">
            {weekdays.map((w) => (
              <span role="columnheader" key={w} className="pb-2 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                {w}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d) => {
              const key = toLocalDateISO(d)
              const inMonth = isSameMonth(d, month)
              const future = key > today
              const sel = key === value
              const has = marked.has(key)
              return (
                <div role="gridcell" key={key} className="flex justify-center py-0.5">
                  <button
                    type="button"
                    disabled={future || !inMonth}
                    aria-pressed={sel}
                    aria-label={`${format(d, 'd MMMM', { locale })}${has ? `, ${t('calendar.hasRecords')}` : ''}`}
                    onClick={() => onPick(key)}
                    className={cn(
                      'tabular relative flex size-11 flex-col items-center justify-center rounded-full text-[15px] transition-colors',
                      !inMonth && 'invisible',
                      future ? 'text-ink-faint/50' : 'text-ink hover:bg-raised',
                      has && !sel && 'font-semibold',
                      sel && 'bg-ink text-bg hover:bg-ink',
                      key === today && !sel && 'ring-1 ring-inset ring-volt/60',
                    )}
                  >
                    {format(d, 'd')}
                    {has && <span aria-hidden className={cn('absolute bottom-1.5 size-1 rounded-full', sel ? 'bg-bg' : 'bg-volt')} />}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
