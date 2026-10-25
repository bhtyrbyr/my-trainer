import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { ArrowLeft, Play, Thermometer, Trash2 } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { exerciseName, useExercisesByIds } from '@/features/exercises'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { sessionTitle } from '../components/sessionTitle'
import { useDateLocale, useDeleteSession, useSessionBundle, useWeightUnit } from '../hooks'
import { formatClock, isWorkingSet, paceSecPerKm, sessionVolumeKg } from '../logic'
import { useIsPreview } from '../previewContext'

export function SessionDetailPage({ sessionId }: { sessionId?: string }) {
  const params = useParams()
  const id = sessionId ?? params.id ?? ''
  const { t, i18n } = useTranslation('workouts')
  const navigate = useNavigate()
  const preview = useIsPreview()
  const locale = useDateLocale()
  const w = useWeightUnit()
  const bundle = useSessionBundle(id)
  const del = useDeleteSession()
  const [confirm, setConfirm] = useState(false)
  const data = bundle.data
  const ids = useMemo(() => [...new Set((data?.exercises ?? []).map((e) => e.exercise_id))], [data])
  const exercises = useExercisesByIds(ids)
  const byId = new Map((exercises.data ?? []).map((e) => [e.id, e]))
  const back = preview ? '/__dev/workouts/history' : '/workouts/history'

  const header = (
    <div className="flex items-center gap-1">
      <Link to={back} aria-label={t('common.back')} className="-ml-2 flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink">
        <ArrowLeft className="size-5" aria-hidden />
      </Link>
      <span className="text-lg font-bold tracking-tight">{t('detail.title')}</span>
    </div>
  )

  if (bundle.isLoading) {
    return (
      <PageShell title={t('detail.title')} leading={header}>
        <div className="h-64 animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none" />
      </PageShell>
    )
  }
  if (!data) {
    return (
      <PageShell title={t('detail.title')} leading={header}>
        <ErrorNote error={bundle.error ?? { code: 'PGRST116' }} />
      </PageShell>
    )
  }

  const s = data.session
  const started = new Date(s.started_at)
  const allSets = data.exercises.flatMap((e) => e.sets)
  const withSets = data.exercises.filter((e) => e.sets.length > 0)
  const title = sessionTitle({ ...s, templateName: data.templateName, cardio: data.cardio }, t)
  const cardio = data.cardio[0]
  const durationSec = s.duration_sec ?? cardio?.duration_sec ?? 0

  return (
    <PageShell title={title} leading={header}>
      <div className="mx-auto max-w-2xl">
        <p className="eyebrow">{format(started, 'EEEE, d MMMM yyyy · HH:mm', { locale })}</p>
        <h1 className="display mt-2 text-[32px]">{title}</h1>

        {!s.ended_at && (
          <div className="hairline mt-5 flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-surface p-4">
            <p className="text-sm text-ink-muted">{t('detail.inProgress')}</p>
            <Button onClick={() => navigate(`/workouts/session/${s.id}`)}>
              <Play className="size-4 fill-current" aria-hidden />
              {t('today.resume')}
            </Button>
          </div>
        )}

        <dl className="mt-6 grid grid-cols-3 border-y border-line">
          {s.kind === 'cardio' && cardio ? (
            <>
              <Stat label={t('summary.duration')} value={formatClock(durationSec)} />
              <Stat label={t('units.km')} value={cardio.distance_m ? w.formatNumber(Math.round(cardio.distance_m / 10) / 100) : '–'} border />
              <Stat
                label={cardio.avg_hr ? t('units.bpm') : t('cardio.pace')}
                value={
                  cardio.avg_hr
                    ? String(cardio.avg_hr)
                    : (() => {
                        const p = paceSecPerKm(cardio.duration_sec, cardio.distance_m)
                        return p ? formatClock(p) : '–'
                      })()
                }
                border
              />
            </>
          ) : (
            <>
              <Stat label={t('summary.duration')} value={formatClock(durationSec)} />
              <Stat label={t('summary.sets')} value={String(s.ended_at ? s.total_sets : allSets.filter(isWorkingSet).length)} border />
              <Stat
                label={t('summary.volume', { unit: w.unit })}
                value={w.formatTotal(s.ended_at ? Number(s.total_volume_kg) : sessionVolumeKg(allSets))}
                border
              />
            </>
          )}
        </dl>

        {s.kind === 'cardio' && cardio && (
          <p className="mt-4 text-sm text-ink-muted">{t(`cardio.activity.${cardio.activity}`)}</p>
        )}

        {withSets.length > 0 && (
          <div className="mt-8 space-y-7">
            {withSets.map((ex) => {
              const meta = byId.get(ex.exercise_id)
              const vol = sessionVolumeKg(ex.sets)
              let n = 0
              return (
                <section key={ex.id} aria-label={meta ? exerciseName(meta, i18n.resolvedLanguage) : undefined}>
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    {preview ? (
                      <h2 className="truncate text-[17px] font-semibold">{meta ? exerciseName(meta, i18n.resolvedLanguage) : '…'}</h2>
                    ) : (
                      <Link to={`/exercises/${ex.exercise_id}`} className="truncate text-[17px] font-semibold hover:text-volt">
                        {meta ? exerciseName(meta, i18n.resolvedLanguage) : '…'}
                      </Link>
                    )}
                    {vol > 0 && (
                      <span className="tabular shrink-0 text-[13px] text-ink-faint">
                        {w.formatTotal(vol)} {w.unit}
                      </span>
                    )}
                  </div>
                  <ol className="divide-y divide-line border-y border-line">
                    {ex.sets.map((set) => {
                      if (!set.is_warmup) n += 1
                      return (
                        <li key={set.id} className="tabular flex h-11 items-center gap-3 text-[15px]">
                          <span className={set.is_warmup ? 'w-6 text-[13px] font-semibold text-ink-faint' : 'w-6 text-[13px] font-semibold text-volt'}>
                            {set.is_warmup ? <Thermometer className="size-3.5" aria-label={t('session.warmup')} /> : n}
                          </span>
                          <span className="flex-1 font-medium">
                            {set.weight_kg != null ? `${w.format(set.weight_kg)} ${w.unit} × ${set.reps ?? 0}` : `${set.reps ?? 0} ${t('units.reps')}`}
                          </span>
                          {set.rpe != null && <span className="text-[13px] text-ink-faint">RPE {w.formatNumber(set.rpe)}</span>}
                        </li>
                      )
                    })}
                  </ol>
                </section>
              )
            })}
          </div>
        )}

        {s.kind === 'strength' && withSets.length === 0 && <p className="mt-8 text-sm text-ink-faint">{t('detail.noSets')}</p>}

        <div className="mt-12 border-t border-line pt-4">
          <Button variant="ghost" className="text-danger hover:text-danger" onClick={() => setConfirm(true)}>
            <Trash2 className="size-4" aria-hidden />
            {t('detail.delete')}
          </Button>
        </div>
      </div>

      <ConfirmSheet
        open={confirm}
        title={t('detail.deleteTitle')}
        body={t('detail.deleteBody')}
        confirmLabel={t('detail.delete')}
        tone="danger"
        pending={del.isPending}
        error={del.error}
        onCancel={() => setConfirm(false)}
        onConfirm={() => del.mutate(s.id, { onSuccess: () => navigate(back, { replace: true }) })}
      />
    </PageShell>
  )
}

function Stat({ label, value, border }: { label: string; value: string; border?: boolean }) {
  return (
    <div className={border ? 'flex flex-col-reverse border-l border-line py-4 pl-4' : 'flex flex-col-reverse py-4 pr-2'}>
      <dt className="mt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">{label}</dt>
      <dd className="display tabular text-[28px] leading-none">{value}</dd>
    </div>
  )
}
