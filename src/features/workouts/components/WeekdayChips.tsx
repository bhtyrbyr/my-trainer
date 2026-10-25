import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { ISO_WEEKDAYS, normalizeWeekdays, toggleWeekday, type IsoWeekday } from '../logic'

/**
 * Week filter for the plan list. "All week" is the default and is shown as a selected option, so a
 * day cell only ever looks selected when the user picked it. Each day shows how many plans it has;
 * today carries a small "today" label instead of an outline (an outline read as "selected").
 */
export function WeekStrip({
  counts,
  today,
  selected,
  onSelect,
}: {
  counts: ReadonlyMap<number, number>
  today: IsoWeekday
  selected: IsoWeekday | null
  onSelect: (d: IsoWeekday | null) => void
}) {
  const { t } = useTranslation('workouts')
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <span className="eyebrow">{t('plans.filterLabel')}</span>
        <button
          type="button"
          aria-pressed={selected === null}
          onClick={() => onSelect(null)}
          className={cn(
            'h-11 rounded-full px-4 text-[13px] font-semibold transition-colors',
            selected === null ? 'bg-volt text-volt-ink' : 'hairline text-ink-muted hover:text-ink',
          )}
        >
          {t('plans.allWeek')}
        </button>
      </div>
      <div role="group" aria-label={t('plans.weekLabel')} className="grid grid-cols-7 gap-1.5">
        {ISO_WEEKDAYS.map((d) => {
          const isSel = selected === d
          const n = counts.get(d) ?? 0
          const isToday = d === today
          return (
            <button
              key={d}
              type="button"
              aria-pressed={isSel}
              aria-label={`${t(`weekday.long.${d}`)}${isToday ? `, ${t('plans.today')}` : ''}, ${n ? t('plans.count', { count: n }) : t('plans.countNone')}`}
              onClick={() => onSelect(isSel ? null : d)}
              className={cn(
                'flex h-16 flex-col items-center justify-center rounded-[var(--radius-input)] transition-colors',
                isSel ? 'bg-volt text-volt-ink' : 'hairline bg-surface hover:bg-raised',
              )}
            >
              <span className={cn('text-[12px] font-semibold', isSel ? '' : isToday ? 'text-ink' : 'text-ink-muted')}>{t(`weekday.short.${d}`)}</span>
              <span className={cn('tabular mt-0.5 text-[17px] font-bold leading-none', isSel ? '' : n ? 'text-ink' : 'text-ink-faint/60')}>{n || '–'}</span>
              <span className={cn('mt-1 h-3 text-[9px] font-bold uppercase tracking-[0.08em]', isSel ? '' : 'text-volt')}>{isToday ? t('plans.today') : ''}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Multi-select of plan days, Monday first. */
export function WeekdayPicker({ value, onChange }: { value: readonly number[]; onChange: (days: IsoWeekday[]) => void }) {
  const { t } = useTranslation('workouts')
  const set = new Set(normalizeWeekdays(value))
  return (
    <div role="group" aria-label={t('editor.days')} className="grid grid-cols-7 gap-1.5">
      {ISO_WEEKDAYS.map((d) => {
        const on = set.has(d)
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            aria-label={t(`weekday.long.${d}`)}
            onClick={() => onChange(toggleWeekday(value, d))}
            className={cn(
              'h-12 rounded-[var(--radius-input)] text-[13px] font-semibold transition-colors',
              on ? 'inner-glow bg-volt text-volt-ink' : 'hairline bg-surface text-ink-muted hover:text-ink',
            )}
          >
            {t(`weekday.short.${d}`)}
          </button>
        )
      })}
    </div>
  )
}
