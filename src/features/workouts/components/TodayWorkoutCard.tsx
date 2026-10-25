import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Loader2, Play, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { exerciseName, useExercisesByIds } from '@/features/exercises'
import { cn } from '@/lib/utils'
import { useActiveSession, useStartSession, useTemplates, useTodaysTemplates } from '../hooks'
import { estimateDurationSec, isoWeekday, nextPlannedDay, roundMinutes } from '../logic'
import { useIsPreview } from '../previewContext'
import type { TemplateWithExercises } from '../schema'

/**
 * Point of view: a race-day start card. One plan, two figures (exercises, minutes) set as display numerals,
 * one volt button in the thumb zone. When nothing is planned it says so plainly and offers a free session.
 */
export function TodayWorkoutCard({ variant = 'workouts' }: { variant?: 'workouts' | 'dashboard' }) {
  const { t } = useTranslation('workouts')
  const navigate = useNavigate()
  const preview = useIsPreview()
  const templates = useTemplates()
  const today = useTodaysTemplates()
  const active = useActiveSession()
  const start = useStartSession()
  const [pickedId, setPickedId] = useState<string | null>(null)
  const weekday = isoWeekday()

  const all = templates.data ?? []
  const todays = (today.data ?? [])
    .map((tpl) => all.find((x) => x.id === tpl.id))
    .filter((x): x is TemplateWithExercises => Boolean(x))
  const hero = todays.find((x) => x.id === pickedId) ?? todays[0] ?? null

  const go = (tpl: TemplateWithExercises | null) =>
    start.mutate(tpl, { onSuccess: (id) => navigate(preview ? '/__dev/workouts/session' : `/workouts/session/${id}`) })

  const loading = templates.isLoading || today.isLoading || active.isLoading
  if (loading) return <div className="h-60 animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none" aria-busy="true" />

  const error = templates.error ?? today.error ?? active.error ?? start.error

  // A session is already running: resuming it is the only sensible action.
  if (active.data) {
    const s = active.data
    const minutes = Math.max(1, Math.round((Date.now() - new Date(s.started_at).getTime()) / 60_000))
    return (
      <Frame glow>
        <p className="eyebrow text-volt">{t('today.inProgress')}</p>
        <h2 className="display mt-3 text-[32px]">{s.title ?? t('session.freeTitle')}</h2>
        <p className="mt-2 text-sm text-ink-muted">{t('today.startedAgo', { n: minutes })}</p>
        <ErrorNote error={error} className="mt-4" />
        <Button size="lg" className="mt-6 w-full" onClick={() => navigate(preview ? '/__dev/workouts/session' : `/workouts/session/${s.id}`)}>
          <RotateCcw className="size-5" aria-hidden />
          {t('today.resume')}
        </Button>
      </Frame>
    )
  }

  if (hero) {
    const minutes = roundMinutes(estimateDurationSec(hero.template_exercises))
    const others = todays.filter((x) => x.id !== hero.id)
    return (
      <Frame glow>
        <div className="flex items-baseline justify-between gap-3">
          <p className="eyebrow text-volt">{t('today.title')}</p>
          <p className="eyebrow">{t(`weekday.long.${weekday}`)}</p>
        </div>
        <h2 className="display mt-3 text-[34px] leading-[1.02]">{hero.name}</h2>

        <dl className="mt-5 flex gap-8">
          <Figure value={hero.template_exercises.length} label={t('today.exercises', { count: hero.template_exercises.length })} />
          <Figure value={minutes ? `~${minutes}` : '–'} label={t('today.minutes')} />
        </dl>

        <ExerciseLine ids={hero.template_exercises.map((x) => x.exercise_id)} />

        <ErrorNote error={error} className="mt-4" />
        <Button size="lg" className="mt-6 w-full" disabled={start.isPending} onClick={() => go(hero)}>
          {start.isPending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Play className="size-5 fill-current" aria-hidden />}
          {t('today.start')}
        </Button>

        {others.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-faint">{t('today.alsoToday')}</span>
            {others.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setPickedId(o.id)}
                className="hairline h-9 rounded-full bg-raised px-3.5 text-[13px] font-medium text-ink-muted hover:text-ink"
              >
                {o.name}
              </button>
            ))}
          </div>
        )}
        {variant === 'dashboard' && <AllPlansLink />}
      </Frame>
    )
  }

  const next = nextPlannedDay(all, weekday)
  return (
    <Frame>
      <div className="flex items-baseline justify-between gap-3">
        <p className="eyebrow">{t('today.title')}</p>
        <p className="eyebrow">{t(`weekday.long.${weekday}`)}</p>
      </div>
      {all.length === 0 ? (
        <>
          <h2 className="display mt-3 text-[30px]">{t('today.noPlansTitle')}</h2>
          <p className="mt-2 text-[15px] text-ink-muted">{t('today.noPlansBody')}</p>
          <ErrorNote error={error} className="mt-4" />
          <div className="mt-6 grid gap-2">
            <Button size="lg" onClick={() => navigate(preview ? '/__dev/workouts/plan' : '/workouts/plans/new')}>
              {t('plans.create')}
            </Button>
            <Button size="lg" variant="secondary" disabled={start.isPending} onClick={() => go(null)}>
              {t('today.startEmpty')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <h2 className="display mt-3 text-[30px]">{t('today.restDay')}</h2>
          {next && (
            <p className="mt-3 text-[15px] text-ink-muted">
              <span className="text-ink-faint">{t('today.next')} </span>
              <span className="font-semibold text-ink">{t(`weekday.long.${next.weekday}`)}</span>
              <span className="text-ink-faint"> · </span>
              {next.templates.map((x) => x.name).join(', ')}
              <span className="text-ink-faint"> · {t('today.inDays', { count: next.daysAhead })}</span>
            </p>
          )}
          <ErrorNote error={error} className="mt-4" />
          <div className="mt-6 grid gap-2">
            <Button size="lg" variant="secondary" disabled={start.isPending} onClick={() => go(null)}>
              {start.isPending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
              {t('today.startEmpty')}
            </Button>
            {next && (
              <Button variant="ghost" disabled={start.isPending} onClick={() => go(next.templates[0])}>
                {t('today.startAnyway', { name: next.templates[0].name })}
              </Button>
            )}
          </div>
        </>
      )}
      {variant === 'dashboard' && <AllPlansLink />}
    </Frame>
  )
}

function Frame({ children, glow }: { children: React.ReactNode; glow?: boolean }) {
  return (
    <section className="hairline relative overflow-hidden rounded-[var(--radius-card)] bg-surface p-5">
      {glow && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full"
          style={{ background: 'radial-gradient(circle, oklch(91% 0.21 125 / 16%), transparent 70%)' }}
        />
      )}
      <div className="relative">{children}</div>
    </section>
  )
}

function Figure({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="mt-1.5 text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="display tabular text-[44px] leading-none">{value}</dd>
    </div>
  )
}

function ExerciseLine({ ids }: { ids: string[] }) {
  const { i18n } = useTranslation()
  const { data } = useExercisesByIds(ids)
  if (!ids.length || !data?.length) return null
  const byId = new Map(data.map((e) => [e.id, e]))
  const names = ids.map((id) => byId.get(id)).filter(Boolean).map((e) => exerciseName(e!, i18n.resolvedLanguage))
  return <p className={cn('mt-5 line-clamp-2 text-[13px] leading-relaxed text-ink-muted')}>{names.join(' · ')}</p>
}

function AllPlansLink() {
  const { t } = useTranslation('workouts')
  return (
    <Link to="/workouts" className="mt-4 inline-flex h-11 items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
      {t('today.allPlans')}
      <ArrowRight className="size-4" aria-hidden />
    </Link>
  )
}
