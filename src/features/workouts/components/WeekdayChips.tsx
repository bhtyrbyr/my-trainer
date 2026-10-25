import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { ISO_WEEKDAYS, normalizeWeekdays, toggleWeekday, type IsoWeekday } from '../logic'

/**
 * Week at a glance: Mon..Sun, a volt dot under days that have a plan, today outlined.
 * Tapping a day filters the schedule below; tapping it again clears the filter.
 */
export function WeekStrip({
  planned,
  today,
  selected,
  onSelect,
}: {
  planned: ReadonlySet<number>
  today: IsoWeekday
  selected: IsoWeekday | null
  onSelect: (d: IsoWeekday | null) => void
}) {
  const { t } = useTranslation('workouts')
  return (
    <div role="group" aria-label={t('plans.weekLabel')} className="grid grid-cols-7 gap-1.5">
      {ISO_WEEKDAYS.map((d) => {
        const isSel = selected === d
        const has = planned.has(d)
        return (
          <button
            key={d}
            type="button"
            aria-pressed={isSel}
            aria-label={`${t(`weekday.long.${d}`)}${has ? `, ${t('plans.hasPlan')}` : ''}`}
            onClick={() => onSelect(isSel ? null : d)}
            className={cn(
              'flex h-14 flex-col items-center justify-center gap-1.5 rounded-[var(--radius-input)] text-[13px] font-semibold transition-colors',
              isSel ? 'bg-ink text-bg' : 'bg-surface text-ink-muted hover:text-ink',
              d === today && !isSel && 'ring-1 ring-inset ring-volt/60 text-ink',
            )}
          >
            <span>{t(`weekday.short.${d}`)}</span>
            <span aria-hidden className={cn('size-1.5 rounded-full', has ? (isSel ? 'bg-bg' : 'bg-volt') : 'bg-transparent')} />
          </button>
        )
      })}
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
