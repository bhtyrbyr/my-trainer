import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen, CalendarDays, HeartPulse, Plus } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { CardioSheet } from '../components/CardioSheet'
import { PlanSchedule } from '../components/PlanSchedule'
import { TodayWorkoutCard } from '../components/TodayWorkoutCard'
import { WeekStrip } from '../components/WeekdayChips'
import { useActiveSession, useStartSession, useTemplates } from '../hooks'
import { isoWeekday, normalizeWeekdays, type IsoWeekday } from '../logic'
import { useIsPreview } from '../previewContext'

/**
 * Workouts tab. Top to bottom by urgency: what to do today, quick cardio/history, then the week's plan.
 * Desktop: today + quick actions on the left, the weekly schedule on the right.
 */
export function WorkoutsPage() {
  const { t } = useTranslation(['workouts', 'common'])
  const navigate = useNavigate()
  const preview = useIsPreview()
  const templates = useTemplates()
  const start = useStartSession()
  const active = useActiveSession()
  const [filter, setFilter] = useState<IsoWeekday | null>(null)
  const [cardioOpen, setCardioOpen] = useState(false)
  const today = isoWeekday()
  const list = templates.data ?? []
  const planned = new Set(list.flatMap((tpl) => normalizeWeekdays(tpl.weekdays)))

  const paths = preview
    ? { edit: () => '/__dev/workouts/plan', new: '/__dev/workouts/plan', history: '/__dev/workouts/history', session: () => '/__dev/workouts/session' }
    : { edit: (id: string) => `/workouts/plans/${id}`, new: '/workouts/plans/new', history: '/workouts/history', session: (id: string) => `/workouts/session/${id}` }

  return (
    <PageShell
      title={t('common:nav.workouts')}
      actions={
        <Link
          to="/exercises"
          className="flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink-muted hover:bg-raised hover:text-ink"
        >
          <BookOpen className="size-4" aria-hidden />
          {t('workouts:library')}
        </Link>
      }
    >
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className="space-y-3">
          <div className="rise-in">
            <TodayWorkoutCard />
          </div>
          <div className="rise-in grid grid-cols-2 gap-2" style={{ ['--i' as string]: 1 }}>
            <button
              type="button"
              onClick={() => setCardioOpen(true)}
              className="hairline flex h-14 items-center justify-center gap-2 rounded-[var(--radius-button)] bg-surface text-[15px] font-semibold hover:bg-raised"
            >
              <HeartPulse className="size-5 text-ink-muted" aria-hidden />
              {t('workouts:cardio.quick')}
            </button>
            <Link
              to={paths.history}
              className="hairline flex h-14 items-center justify-center gap-2 rounded-[var(--radius-button)] bg-surface text-[15px] font-semibold hover:bg-raised"
            >
              <CalendarDays className="size-5 text-ink-muted" aria-hidden />
              {t('workouts:history.title')}
            </Link>
          </div>
        </div>

        <section className="rise-in mt-9 lg:mt-0" style={{ ['--i' as string]: 2 }} aria-labelledby="plans-heading">
          <div className="mb-3 flex items-end justify-between gap-3 px-1">
            <div>
              <p className="eyebrow">{t('workouts:plans.eyebrow')}</p>
              <h2 id="plans-heading" className="display mt-1 text-[24px]">
                {t('workouts:plans.title')}
              </h2>
            </div>
            <Link
              to={paths.new}
              className="hairline flex h-11 items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-sm font-semibold hover:bg-raised"
            >
              <Plus className="size-4 text-volt" aria-hidden />
              {t('workouts:plans.new')}
            </Link>
          </div>

          <ErrorNote error={templates.error ?? start.error} className="mb-3" />
          <WeekStrip planned={planned} today={today} selected={filter} onSelect={setFilter} />

          <div className="mt-5">
            {templates.isLoading ? (
              <div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none" />
            ) : list.length === 0 ? (
              <p className="px-1 text-sm text-ink-faint">{t('workouts:plans.none')}</p>
            ) : (
              <PlanSchedule
                templates={list}
                today={today}
                filter={filter}
                startDisabled={start.isPending || Boolean(active.data)}
                onStart={(tpl) => start.mutate(tpl, { onSuccess: (id) => navigate(paths.session(id)) })}
                editHref={paths.edit}
                newHref={paths.new}
              />
            )}
          </div>
        </section>
      </div>

      <CardioSheet open={cardioOpen} onClose={() => setCardioOpen(false)} />
    </PageShell>
  )
}
