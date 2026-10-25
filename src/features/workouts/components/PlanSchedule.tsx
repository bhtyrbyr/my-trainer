import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { estimateDurationSec, groupByWeekday, roundMinutes, type IsoWeekday } from '../logic'
import type { TemplateWithExercises } from '../schema'

type Props = {
  templates: TemplateWithExercises[]
  today: IsoWeekday
  /** only this weekday (from the week strip), or the whole week */
  filter: IsoWeekday | null
  onStart: (t: TemplateWithExercises) => void
  startDisabled?: boolean
  editHref: (id: string) => string
  newHref: string
}

/** The week as a schedule: day label, then ruled rows (name, exercises, minutes, start). */
export function PlanSchedule({ templates, today, filter, onStart, startDisabled, editHref, newHref }: Props) {
  const { t } = useTranslation('workouts')
  const { days, unassigned } = groupByWeekday(templates)
  const visible = days.filter((d) => (filter ? d.weekday === filter : d.templates.length > 0))

  return (
    <div className="space-y-5">
      {visible.map(({ weekday, templates: list }) => (
        <section key={weekday} aria-labelledby={`day-${weekday}`}>
          <h3 id={`day-${weekday}`} className="mb-2 flex items-center gap-2 px-1">
            <span className="eyebrow">{t(`weekday.long.${weekday}`)}</span>
            {weekday === today && <span className="rounded-full bg-volt/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-volt">{t('plans.today')}</span>}
          </h3>
          {list.length ? (
            <Rows list={list} onStart={onStart} startDisabled={startDisabled} editHref={editHref} />
          ) : (
            <div className="hairline flex items-center justify-between rounded-[var(--radius-card)] px-4 py-3.5">
              <span className="text-sm text-ink-faint">{t('plans.emptyDay')}</span>
              <Link to={newHref} className="flex h-11 items-center text-sm font-semibold text-volt">
                {t('plans.add')}
              </Link>
            </div>
          )}
        </section>
      ))}

      {!filter && unassigned.length > 0 && (
        <section aria-labelledby="day-none">
          <h3 id="day-none" className="eyebrow mb-2 px-1">
            {t('plans.unassigned')}
          </h3>
          <Rows list={unassigned} onStart={onStart} startDisabled={startDisabled} editHref={editHref} />
        </section>
      )}
    </div>
  )
}

function Rows({
  list,
  onStart,
  startDisabled,
  editHref,
}: {
  list: TemplateWithExercises[]
  onStart: (t: TemplateWithExercises) => void
  startDisabled?: boolean
  editHref: (id: string) => string
}) {
  const { t } = useTranslation('workouts')
  return (
    <ul className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
      {list.map((tpl) => {
        const n = tpl.template_exercises.length
        const min = roundMinutes(estimateDurationSec(tpl.template_exercises))
        return (
          <li key={tpl.id} className="flex items-center">
            <Link to={editHref(tpl.id)} className="flex min-w-0 flex-1 items-center gap-3 py-3.5 pl-4 pr-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold">{tpl.name}</span>
                <span className="tabular block text-[13px] text-ink-muted">
                  {t('plans.meta', { count: n, min })}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
            </Link>
            <button
              type="button"
              disabled={startDisabled || n === 0}
              aria-label={t('plans.startNamed', { name: tpl.name })}
              onClick={() => onStart(tpl)}
              className={cn(
                'mr-2 flex size-11 shrink-0 items-center justify-center rounded-full bg-raised text-volt transition-colors hover:bg-volt hover:text-volt-ink disabled:opacity-30',
              )}
            >
              <Play className="size-4 fill-current" aria-hidden />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
