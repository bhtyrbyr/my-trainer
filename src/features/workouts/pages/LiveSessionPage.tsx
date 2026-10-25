import { useCallback, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { Check, Info, Loader2, Plus, SkipForward, Thermometer, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { ExercisePickerSheet, exerciseName, useExercisesByIds, type Exercise } from '@/features/exercises'
import { ExerciseDemo } from '../components/ExerciseDemo'
import { readDemoExpanded, writeDemoExpanded } from '../components/demoPreference'
import { cn } from '@/lib/utils'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { RestTimer } from '../components/RestTimer'
import { SessionSummary } from '../components/SessionSummary'
import { Stepper } from '../components/Stepper'
import {
  useAddSessionExercise,
  useAddSet,
  useDateLocale,
  useDeleteSession,
  useDeleteSet,
  useFinishSession,
  useLastSets,
  useSessionBundle,
  useWeightUnit,
} from '../hooks'
import {
  DEFAULT_REST_SEC,
  clamp,
  extendRest,
  formatClock,
  formatSetList,
  isWorkingSet,
  nextExerciseIndex,
  prefillNextSet,
  sessionVolumeKg,
  workingSetCount,
} from '../logic'
import { useIsPreview } from '../previewContext'
import { primeAudio } from '../restAlert'
import type { BundleExercise, FinishSummary, SessionBundle } from '../schema'
import { useNow, useSessionDraft, useWakeLock } from '../sessionHooks'

export function LiveSessionPage() {
  const { id } = useParams()
  return <LiveSession key={id} sessionId={id ?? ''} />
}

/**
 * Guided session. Point of view: one set at a time on an instrument panel. The exercise name and the two
 * figures you are about to lift (kg, reps) dominate; history ("last time") sits right above them as the
 * reference; the one volt action is always under the thumb. Full-screen layer: the tab bar is hidden.
 */
export function LiveSession({ sessionId }: { sessionId: string }) {
  const { t, i18n } = useTranslation('workouts')
  const navigate = useNavigate()
  const preview = useIsPreview()
  const bundle = useSessionBundle(sessionId)
  const { draft, update, clear } = useSessionDraft(sessionId)
  const [summary, setSummary] = useState<FinishSummary | null>(null)
  const exerciseIds = useMemo(() => [...new Set((bundle.data?.exercises ?? []).map((e) => e.exercise_id))], [bundle.data])
  const exercisesQ = useExercisesByIds(exerciseIds)
  const [picked, setPicked] = useState<Map<string, Exercise>>(new Map())
  const byId = useMemo(() => {
    const m = new Map(picked)
    for (const e of exercisesQ.data ?? []) m.set(e.id, e)
    return m
  }, [exercisesQ.data, picked])
  const label = useCallback(
    (exerciseId: string) => {
      const ex = byId.get(exerciseId)
      return ex ? exerciseName(ex, i18n.resolvedLanguage) : '…'
    },
    [byId, i18n.resolvedLanguage],
  )
  const home = preview ? '/__dev/workouts' : '/workouts'

  useWakeLock(!summary && Boolean(bundle.data && !bundle.data.session.ended_at))

  if (summary) {
    return (
      <Layer>
        <SessionSummary
          title={bundle.data?.session.title ?? t('session.freeTitle')}
          summary={summary}
          exerciseLabel={label}
          onDone={() => navigate(home)}
          onHistory={preview ? undefined : () => navigate(`/workouts/history/${sessionId}`)}
        />
      </Layer>
    )
  }

  if (bundle.isLoading) {
    return (
      <Layer>
        <div className="flex min-h-dvh items-center justify-center text-ink-faint">
          <Loader2 className="size-6 animate-spin" aria-label={t('common.loading')} />
        </div>
      </Layer>
    )
  }

  if (!bundle.data) {
    return (
      <Layer>
        <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-5">
          <h1 className="display text-[28px]">{t('session.notFound')}</h1>
          <ErrorNote error={bundle.error} />
          <Button size="lg" onClick={() => navigate(home)}>
            {t('common.back')}
          </Button>
        </div>
      </Layer>
    )
  }

  if (bundle.data.session.ended_at || bundle.data.session.kind !== 'strength') {
    return <Navigate to={`/workouts/history/${sessionId}`} replace />
  }

  return (
    <Layer>
      <Runner
        data={bundle.data}
        draft={draft}
        update={update}
        label={label}
        byId={byId}
        onPicked={(ex) => setPicked((m) => new Map(m).set(ex.id, ex))}
        onFinished={(s) => {
          clear()
          setSummary(s)
        }}
        onDiscarded={() => {
          clear()
          navigate(home)
        }}
        home={home}
      />
    </Layer>
  )
}

function Layer({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-bg">{children}</div>
}

type RunnerProps = {
  data: SessionBundle
  draft: ReturnType<typeof useSessionDraft>['draft']
  update: ReturnType<typeof useSessionDraft>['update']
  label: (exerciseId: string) => string
  byId: Map<string, Exercise>
  onPicked: (ex: Exercise) => void
  onFinished: (s: FinishSummary) => void
  onDiscarded: () => void
  home: string
}

function Runner({ data, draft, update, label, byId, onPicked, onFinished, onDiscarded, home }: RunnerProps) {
  const { t } = useTranslation('workouts')
  const w = useWeightUnit()
  const sessionId = data.session.id
  const exercises = data.exercises
  const idx = exercises.length ? clamp(draft.exerciseIndex, 0, exercises.length - 1) : -1
  const current = idx >= 0 ? exercises[idx] : null
  const addSet = useAddSet(sessionId)
  const deleteSet = useDeleteSet(sessionId)
  const addExercise = useAddSessionExercise(sessionId)
  const finish = useFinishSession()
  const discard = useDeleteSession()
  const [picker, setPicker] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const now = useNow(1000)

  const allSets = exercises.flatMap((e) => e.sets)
  const totalWorking = workingSetCount(allSets)
  const restOn = draft.restEndsAt != null && draft.restEndsAt > now - 1000
  const nextIdx = idx >= 0 ? nextExerciseIndex(exercises, idx, draft.skipped) : null

  const goTo = (i: number | null) => update({ exerciseIndex: i ?? idx, restEndsAt: null, restTotalSec: null })
  const endRest = useCallback(() => update({ restEndsAt: null, restTotalSec: null }), [update])

  const completeSet = (values: { weightKg: number | null; reps: number; rpe: number | null; warmup: boolean }) => {
    if (!current) return
    primeAudio()
    const rest = current.target?.rest_seconds ?? DEFAULT_REST_SEC
    const startRest = rest > 0
    if (startRest) update({ restEndsAt: Date.now() + rest * 1000, restTotalSec: rest })
    addSet.mutate(
      {
        sessionId,
        sessionExerciseId: current.id,
        setNo: current.sets.reduce((m, s) => Math.max(m, s.set_no), 0) + 1,
        weightKg: values.weightKg,
        reps: values.reps,
        rpe: values.rpe,
        isWarmup: values.warmup,
      },
      { onError: () => startRest && endRest() },
    )
  }

  const finishNow = () => {
    const empty = exercises.filter((e) => e.sets.length === 0).map((e) => e.id)
    finish.mutate({ sessionId, emptyExerciseIds: empty }, { onSuccess: onFinished })
  }

  const elapsed = Math.max(0, Math.floor((now - new Date(data.session.started_at).getTime()) / 1000))
  const title = data.session.title ?? t('session.freeTitle')

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col lg:max-w-4xl">
      {/* Header: leave, where am I, finish */}
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 pt-safe backdrop-blur">
        <div className="flex h-14 items-center gap-2 px-2">
          <Link to={home} aria-label={t('session.leave')} className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink">
            <X className="size-5" aria-hidden />
          </Link>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-[13px] font-semibold">{title}</p>
            <p className="tabular text-[12px] text-ink-faint" aria-label={t('session.elapsed', { time: formatClock(elapsed) })}>
              {formatClock(elapsed)}
            </p>
          </div>
          <Button variant="ghost" size="sm" className="h-11 px-3 text-ink" onClick={() => setConfirm(true)}>
            {t('session.finish')}
          </Button>
        </div>
        {exercises.length > 0 && (
          <nav aria-label={t('session.exerciseNav')} className="flex gap-1 px-4 pb-3">
            {exercises.map((e, i) => {
              const target = e.target?.target_sets ?? 0
              const done = e.sets.filter(isWorkingSet).length
              const complete = target > 0 ? done >= target : done > 0
              const skipped = draft.skipped.includes(e.id) && done === 0
              return (
                <button
                  key={e.id}
                  type="button"
                  aria-current={i === idx ? 'step' : undefined}
                  aria-label={t('session.segment', { n: i + 1, name: label(e.exercise_id), done, target: target || '–' })}
                  onClick={() => goTo(i)}
                  className="group flex h-6 flex-1 items-center"
                >
                  <span
                    className={cn(
                      'h-1.5 w-full rounded-full transition-colors',
                      complete ? 'bg-volt' : done > 0 ? 'bg-volt/45' : skipped ? 'bg-line' : 'bg-raised',
                      i === idx && 'ring-2 ring-ink ring-offset-2 ring-offset-bg',
                    )}
                  />
                </button>
              )
            })}
          </nav>
        )}
      </header>

      {current ? (
        <ExerciseStage
          key={current.id}
          exercise={current}
          index={idx}
          count={exercises.length}
          ex={byId.get(current.exercise_id)}
          name={label(current.exercise_id)}
          saving={addSet.isPending}
          error={addSet.error ?? deleteSet.error ?? addExercise.error}
          onComplete={completeSet}
          onUndo={(setId) => deleteSet.mutate(setId)}
          hasNext={nextIdx !== null}
          onNext={() => goTo(nextIdx)}
          onSkip={() => update((d) => ({ skipped: [...new Set([...d.skipped, current.id])], exerciseIndex: nextIdx ?? idx, restEndsAt: null, restTotalSec: null }))}
          onAdd={() => setPicker(true)}
          onFinish={() => setConfirm(true)}
        />
      ) : (
        <div className="flex flex-1 flex-col justify-center px-5 pb-safe">
          <p className="eyebrow">{t('session.emptyEyebrow')}</p>
          <h1 className="display mt-3 text-[34px]">{t('session.emptyTitle')}</h1>
          <p className="mt-2 text-[15px] text-ink-muted">{t('session.emptyBody')}</p>
          <ErrorNote error={addExercise.error} className="mt-4" />
          <Button size="lg" className="mt-8 w-full" onClick={() => setPicker(true)}>
            <Plus className="size-5" aria-hidden />
            {t('session.addExercise')}
          </Button>
        </div>
      )}

      {restOn && current && draft.restEndsAt != null && (
        <RestTimer
          endsAt={draft.restEndsAt}
          totalSec={draft.restTotalSec ?? DEFAULT_REST_SEC}
          onAdd={(sec) => update((d) => ({ restEndsAt: extendRest(d.restEndsAt, Date.now(), sec), restTotalSec: (d.restTotalSec ?? 0) + sec }))}
          onSkip={endRest}
          onEnd={endRest}
          next={<UpNext exercise={current} next={nextIdx !== null ? exercises[nextIdx] : null} label={label} />}
        />
      )}

      <ExercisePickerSheet
        open={picker}
        onClose={() => setPicker(false)}
        title={t('session.addExercise')}
        selectedIds={exercises.map((e) => e.exercise_id)}
        onPick={(ex) => {
          onPicked(ex)
          setPicker(false)
          addExercise.mutate(
            { exerciseId: ex.id, existing: exercises },
            { onSuccess: () => update({ exerciseIndex: exercises.length, restEndsAt: null, restTotalSec: null }) },
          )
        }}
      />

      <ConfirmSheet
        open={confirm}
        title={totalWorking > 0 ? t('session.finishTitle') : t('session.discardTitle')}
        body={
          totalWorking > 0
            ? t('session.finishBody', { count: totalWorking, volume: w.formatTotal(sessionVolumeKg(allSets)), unit: w.unit })
            : t('session.discardBody')
        }
        confirmLabel={totalWorking > 0 ? t('session.finishConfirm') : t('session.discardConfirm')}
        tone={totalWorking > 0 ? 'primary' : 'danger'}
        pending={finish.isPending || discard.isPending}
        error={finish.error ?? discard.error}
        onCancel={() => setConfirm(false)}
        onConfirm={() => (totalWorking > 0 ? finishNow() : discard.mutate(sessionId, { onSuccess: onDiscarded }))}
      />
    </div>
  )
}

function UpNext({ exercise, next, label }: { exercise: BundleExercise; next: BundleExercise | null; label: (id: string) => string }) {
  const { t } = useTranslation('workouts')
  const target = exercise.target?.target_sets ?? 0
  const done = exercise.sets.filter(isWorkingSet).length
  const moreHere = target === 0 || done < target
  return (
    <div className="hairline rounded-[var(--radius-card)] bg-surface/80 px-4 py-3.5">
      <p className="eyebrow">{t('rest.upNext')}</p>
      <p className="mt-1.5 truncate text-[16px] font-semibold">
        {moreHere
          ? t('rest.nextSet', { n: done + 1, name: label(exercise.exercise_id) })
          : next
            ? label(next.exercise_id)
            : t('rest.lastDone')}
      </p>
    </div>
  )
}

type StageProps = {
  exercise: BundleExercise
  index: number
  count: number
  ex: Exercise | undefined
  name: string
  saving: boolean
  error: unknown
  onComplete: (v: { weightKg: number | null; reps: number; rpe: number | null; warmup: boolean }) => void
  onUndo: (setId: string) => void
  hasNext: boolean
  onNext: () => void
  onSkip: () => void
  onAdd: () => void
  onFinish: () => void
}

function ExerciseStage({ exercise, index, count, ex, name, saving, error, onComplete, onUndo, hasNext, onNext, onSkip, onAdd, onFinish }: StageProps) {
  const { t } = useTranslation('workouts')
  const w = useWeightUnit()
  const dfLocale = useDateLocale()
  const preview = useIsPreview()
  const last = useLastSets(exercise.exercise_id)
  const target = exercise.target
  const working = exercise.sets.filter(isWorkingSet).length
  const reached = target ? working >= target.target_sets : false

  const lastList = formatSetList(last.data ?? [], (kg) => w.format(kg))
  const lastDate = last.data?.[0]?.started_at

  const prefill = prefillNextSet({ lastTime: last.data ?? [], thisSession: exercise.sets, targetRepsLow: target?.target_reps_low })
  const [demoExpanded, setDemoExpanded] = useState(readDemoExpanded)
  const toggleDemo = () =>
    setDemoExpanded((v) => {
      writeDemoExpanded(!v)
      return !v
    })

  return (
    <div className="flex flex-1 flex-col lg:grid lg:grid-cols-2 lg:gap-10 lg:px-6">
      <section className="rise-in px-5 pt-5 lg:px-0">
        {demoExpanded && <ExerciseDemo gifPath={ex?.gif_path ?? null} name={name} expanded onToggle={toggleDemo} />}
        <div className={cn('flex items-start gap-4', demoExpanded && 'mt-4')}>
          {!demoExpanded && <ExerciseDemo gifPath={ex?.gif_path ?? null} name={name} expanded={false} onToggle={toggleDemo} />}
          <div className="min-w-0 flex-1">
            <p className="eyebrow tabular">{t('session.exerciseOf', { n: index + 1, total: count })}</p>
            <h1 className="display mt-1.5 line-clamp-3 text-[26px] leading-[1.05]">{name}</h1>
            <p className="tabular mt-1.5 text-[13px] text-ink-muted">
              {target
                ? t('session.target', {
                    sets: target.target_sets,
                    reps: target.target_reps_low === target.target_reps_high ? target.target_reps_low : `${target.target_reps_low}–${target.target_reps_high}`,
                    rest: formatClock(target.rest_seconds),
                  })
                : t('session.noTarget')}
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="min-w-0 text-[14px] leading-snug">
            <span className="eyebrow mr-2 align-[1px]">{t('session.last')}</span>
            {last.isLoading ? (
              <span className="text-ink-faint">…</span>
            ) : lastList.length ? (
              <span className="tabular text-ink">
                <span className="font-semibold">{lastList[0].replace(' × ', ` ${w.unit} × `)}</span>
                {lastList.length > 1 && <span className="text-ink-muted">, {lastList.slice(1).join(', ')}</span>}
                {lastDate && <span className="text-ink-faint"> · {format(new Date(lastDate), 'd MMM', { locale: dfLocale })}</span>}
              </span>
            ) : (
              <span className="text-ink-faint">{t('session.firstTime')}</span>
            )}
          </p>
          {!preview && (
            <Link
              to={`/exercises/${exercise.exercise_id}`}
              aria-label={t('session.howTo')}
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-faint hover:bg-raised hover:text-ink"
            >
              <Info className="size-5" aria-hidden />
            </Link>
          )}
        </div>

        {exercise.sets.length > 0 && (
          <ol className="mt-4 divide-y divide-line border-y border-line" aria-label={t('session.doneSets')}>
            {exercise.sets.map((s, i) => {
              const isLast = i === exercise.sets.length - 1
              return (
                <li key={s.id} className="flex h-11 items-center gap-3 text-[15px]">
                  <span className={cn('tabular w-6 text-[13px] font-semibold', s.is_warmup ? 'text-ink-faint' : 'text-volt')}>
                    {s.is_warmup ? <Thermometer className="size-3.5" aria-label={t('session.warmup')} /> : exercise.sets.filter((x, j) => j <= i && !x.is_warmup).length}
                  </span>
                  <span className="tabular flex-1 font-medium">
                    {s.weight_kg != null ? `${w.format(s.weight_kg)} ${w.unit} × ${s.reps ?? 0}` : `${s.reps ?? 0} ${t('units.reps')}`}
                    {s.rpe != null && <span className="ml-2 text-[13px] font-normal text-ink-faint">{t('session.rpeShort')} {w.formatNumber(s.rpe)}</span>}
                  </span>
                  {isLast ? (
                    <button
                      type="button"
                      aria-label={t('session.undoSet')}
                      onClick={() => onUndo(s.id)}
                      className="-mr-2 flex size-11 items-center justify-center rounded-full text-ink-faint hover:bg-raised hover:text-danger"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  ) : (
                    <Check className="size-4 text-ink-faint" aria-hidden />
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <SetEntry
        key={`${exercise.id}:${exercise.sets.length}:${last.isSuccess ? 1 : 0}`}
        setNumber={working + 1}
        targetSets={target?.target_sets ?? null}
        initialWeight={prefill.weightKg != null ? w.toDisplay(prefill.weightKg) : null}
        initialReps={prefill.reps}
        saving={saving}
        error={error}
        reached={reached}
        hasNext={hasNext}
        onComplete={onComplete}
        onNext={onNext}
        onSkip={onSkip}
        onAdd={onAdd}
        onFinish={onFinish}
      />
    </div>
  )
}

type EntryProps = {
  setNumber: number
  targetSets: number | null
  initialWeight: number | null
  initialReps: number | null
  saving: boolean
  error: unknown
  reached: boolean
  hasNext: boolean
  onComplete: StageProps['onComplete']
  onNext: () => void
  onSkip: () => void
  onAdd: () => void
  onFinish: () => void
}

const RPE_VALUES = [6, 7, 8, 9, 10]

function SetEntry(props: EntryProps) {
  const { setNumber, targetSets, initialWeight, initialReps, saving, error, reached, hasNext, onComplete, onNext, onSkip, onAdd, onFinish } = props
  const { t } = useTranslation('workouts')
  const w = useWeightUnit()
  const [weight, setWeight] = useState<number | null>(initialWeight)
  const [reps, setReps] = useState<number | null>(initialReps)
  const [rpe, setRpe] = useState<number | null>(null)
  const [warmup, setWarmup] = useState(false)
  const canSave = reps !== null && reps >= 1 && !saving

  const complete = () =>
    canSave &&
    onComplete({
      weightKg: weight === null || weight === 0 ? null : Math.round(w.toKg(weight) * 100) / 100,
      reps: reps!,
      rpe,
      warmup,
    })

  return (
    <section className="flex flex-1 flex-col px-5 pt-6 lg:px-0 lg:pt-5" aria-labelledby="set-heading">
      <div className="flex items-baseline justify-between">
        <h2 id="set-heading" className="display text-[22px]">
          {warmup ? t('session.warmupSet') : t('session.setN', { n: setNumber })}
          {!warmup && targetSets && setNumber <= targetSets ? <span className="text-ink-faint"> / {targetSets}</span> : null}
        </h2>
        {reached && <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-volt">{t('session.targetReached')}</span>}
      </div>

      <div className="mt-4 space-y-5">
        <Stepper
          label={w.unit}
          value={weight}
          onChange={setWeight}
          step={w.step}
          min={0}
          max={w.unit === 'kg' ? 2000 : 4400}
          decimal
          format={w.formatNumber}
          decLabel={t('session.weightDec', { step: w.step, unit: w.unit })}
          incLabel={t('session.weightInc', { step: w.step, unit: w.unit })}
        />
        <Stepper
          label={t('session.reps')}
          value={reps}
          onChange={setReps}
          step={1}
          min={0}
          max={1000}
          decLabel={t('session.repsDec')}
          incLabel={t('session.repsInc')}
        />
      </div>

      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          aria-pressed={warmup}
          onClick={() => setWarmup((v) => !v)}
          className={cn(
            'h-11 shrink-0 rounded-full px-3 text-[13px] font-semibold transition-colors',
            warmup ? 'bg-ink text-bg' : 'hairline text-ink-muted hover:text-ink',
          )}
        >
          {t('session.warmup')}
        </button>
        <div role="group" aria-label={t('session.rpe')} className="flex min-w-0 flex-1 items-center justify-end">
          <span className="eyebrow mr-1 shrink-0">{t('session.rpeShort')}</span>
          {RPE_VALUES.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={rpe === v}
              onClick={() => setRpe(rpe === v ? null : v)}
              className={cn(
                'tabular size-11 shrink-0 rounded-full text-[14px] font-semibold transition-colors',
                rpe === v ? 'bg-ink text-bg' : 'text-ink-muted hover:bg-raised hover:text-ink',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <ErrorNote error={error} className="mt-4" />

      {/* thumb zone */}
      <div className="sticky bottom-0 mt-auto -mx-5 border-t border-line bg-bg/90 px-5 pb-safe pt-2 backdrop-blur lg:mx-0 lg:px-0">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" className="h-11" onClick={onSkip}>
            <SkipForward className="size-4" aria-hidden />
            {t('session.skip')}
          </Button>
          <Button variant="ghost" size="sm" className="h-11" onClick={onAdd}>
            <Plus className="size-4" aria-hidden />
            {t('session.addExercise')}
          </Button>
        </div>
        <div className="pb-3 pt-1">
          {reached ? (
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <Button variant="secondary" size="lg" className="px-4" disabled={!canSave} onClick={complete}>
                {saving ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Plus className="size-5" aria-hidden />}
                {t('session.extraSet')}
              </Button>
              <Button size="lg" onClick={hasNext ? onNext : onFinish}>
                {hasNext ? t('session.nextExercise') : t('session.finishWorkout')}
              </Button>
            </div>
          ) : (
            <Button size="lg" className="w-full" disabled={!canSave} onClick={complete}>
              {saving ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Check className="size-5" aria-hidden />}
              {t('session.completeSet')}
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
