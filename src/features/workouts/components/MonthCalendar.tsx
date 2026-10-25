import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { ISO_WEEKDAYS, monthGrid } from '../logic'
import { useDateLocale } from '../hooks'

type Props = {
  month: Date
  /** yyyy-MM-dd keys with at least one session */
  marked: ReadonlySet<string>
  selected: string | null
  onSelect: (key: string | null) => void
  todayKey: string
}

/** Monday-first month grid. Training days carry a volt dot and are the only tappable cells. */
export function MonthCalendar({ month, marked, selected, onSelect, todayKey }: Props) {
  const { t } = useTranslation('workouts')
  const locale = useDateLocale()
  const weeks = monthGrid(month)
  return (
    <div role="grid" aria-label={format(month, 'LLLL yyyy', { locale })}>
      <div role="row" className="grid grid-cols-7">
        {ISO_WEEKDAYS.map((d) => (
          <span role="columnheader" key={d} className="pb-2 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            {t(`weekday.short.${d}`)}
          </span>
        ))}
      </div>
      {weeks.map((week) => (
        <div role="row" key={week[0].key} className="grid grid-cols-7">
          {week.map(({ date, key, inMonth }) => {
            const has = marked.has(key)
            const isSel = selected === key
            const isToday = key === todayKey
            return (
              <div role="gridcell" key={key} className="flex justify-center py-0.5">
                <button
                  type="button"
                  disabled={!has || !inMonth}
                  aria-pressed={isSel}
                  aria-label={`${format(date, 'd MMMM', { locale })}${has ? `, ${t('history.trained')}` : ''}`}
                  onClick={() => onSelect(isSel ? null : key)}
                  className={cn(
                    'tabular relative flex size-11 flex-col items-center justify-center rounded-full text-[15px] transition-colors',
                    !inMonth && 'invisible',
                    has ? 'font-semibold text-ink hover:bg-raised' : 'text-ink-faint',
                    isSel && 'bg-ink text-bg hover:bg-ink',
                    isToday && !isSel && 'ring-1 ring-inset ring-volt/60',
                  )}
                >
                  {format(date, 'd')}
                  {has && <span aria-hidden className={cn('absolute bottom-1.5 size-1 rounded-full', isSel ? 'bg-bg' : 'bg-volt')} />}
                </button>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
