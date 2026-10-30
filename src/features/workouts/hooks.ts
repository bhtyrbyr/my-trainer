import { useCallback, useMemo } from 'react'
import { useMutation, useMutationState, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { enUS, tr as trLocale } from 'date-fns/locale'
import { useAuth } from '@/features/auth/AuthProvider'
import { toLocalDateISO } from '@/lib/dates'
import * as api from './api'
import { useUnits } from '@/features/settings/useUnits'
import { isoWeekday, nextPosition, sessionVolumeKg, workingSetCount } from './logic'
import { useIsPreview } from './previewContext'
import type { BundleExercise, CardioInput, FinishSummary, SessionBundle, SessionSet, TemplateInput, TemplateWithExercises, WorkoutSession } from './schema'
import { cancelQueuedInsert, newId, nowISO, registerQueued } from '@/lib/offline/queue'
import { useQueuedMutation, useQueuedOps } from '@/lib/offline/hooks'
import {
  applyActiveOps,
  applySessionOps,
  pendingExerciseRow,
  pendingSetRow,
  queuedRowState,
  withExercise,
  withSet,
  withoutSet,
  workoutQueue,
  type AddExerciseVars,
  type AddSetVars,
  type DeleteSetVars,
  type FinishVars,
  type WorkoutVars,
} from './offline'

export const workoutKeys = {
  all: ['workouts'] as const,
  templates: ['workouts', 'templates'] as const,
  template: (id: string) => ['workouts', 'template', id] as const,
  today: (isodow: number, day: string) => ['workouts', 'today', isodow, day] as const,
  active: ['workouts', 'active'] as const,
  session: (id: string) => ['workouts', 'session', id] as const,
  last: (exerciseId: string) => ['workouts', 'last', exerciseId] as const,
  history: (month: string) => ['workouts', 'history', month] as const,
  energy: (day: string) => ['workouts', 'energy', day] as const,
  day: (day: string) => ['workouts', 'day', day] as const,
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------
/** Estimated kcal burned by the finished workouts of one local day (YYYY-MM-DD). Never added to eaten calories. */
export function useBurnedOn(day: string, previewValue?: { kcal: number; sessions: number }) {
  return useQuery({
    queryKey: workoutKeys.energy(day),
    queryFn: () => {
      const [y, m, d] = day.split('-').map(Number)
      return api.burnedBetween(new Date(y, m - 1, d).toISOString(), new Date(y, m - 1, d + 1).toISOString())
    },
    enabled: !previewValue,
    initialData: previewValue,
    staleTime: 60_000,
  })
}

/** Finished sessions that started on one local day (YYYY-MM-DD). */
export function useSessionsOn(day: string) {
  return useQuery({
    queryKey: workoutKeys.day(day),
    queryFn: () => {
      const [y, m, d] = day.split('-').map(Number)
      return api.listSessionsBetween(new Date(y, m - 1, d).toISOString(), new Date(y, m - 1, d + 1).toISOString())
    },
    staleTime: 60_000,
  })
}

export function useBurnedToday(previewValue?: { kcal: number; sessions: number }) {
  return useBurnedOn(toLocalDateISO(), previewValue)
}

export function useTemplates() {
  return useQuery({ queryKey: workoutKeys.templates, queryFn: api.listTemplates })
}

export function useTemplate(id: string | undefined) {
  return useQuery({ queryKey: workoutKeys.template(id ?? ''), queryFn: () => api.getTemplate(id!), enabled: Boolean(id) })
}

/** Today's plans. The weekday comes from the device clock: the database runs in UTC. */
export function useTodaysTemplates() {
  const day = toLocalDateISO()
  const isodow = isoWeekday()
  return useQuery({ queryKey: workoutKeys.today(isodow, day), queryFn: () => api.todaysTemplates(isodow) })
}

/** The running strength session; null as soon as its finish is queued (offline). */
export function useActiveSession() {
  const q = useQuery({ queryKey: workoutKeys.active, queryFn: api.getActiveSession })
  const ops = useQueuedOps<WorkoutVars>('workouts')
  const data = useMemo(() => applyActiveOps(q.data, ops), [q.data, ops])
  return { ...q, data }
}

/** One session with its exercises and sets; queued (not yet synced) writes are shown on top. */
export function useSessionBundle(id: string | undefined) {
  const q = useQuery({ queryKey: workoutKeys.session(id ?? ''), queryFn: () => api.getSessionBundle(id!), enabled: Boolean(id) })
  const ops = useQueuedOps<WorkoutVars>('workouts')
  const data = useMemo(() => applySessionOps(q.data, ops), [q.data, ops])
  return { ...q, data }
}

/** id -> 'pending' | 'error' for sets/exercises that are not on the server yet. */
export function useQueuedWorkoutRows() {
  const ops = useQueuedOps<WorkoutVars>('workouts')
  return useMemo(() => queuedRowState(ops), [ops])
}

export function useLastSets(exerciseId: string | undefined) {
  return useQuery({
    queryKey: workoutKeys.last(exerciseId ?? ''),
    queryFn: () => api.lastSetsForExercise(exerciseId!),
    enabled: Boolean(exerciseId),
    staleTime: 5 * 60_000,
  })
}

/** Finished sessions whose start lies in [from, to). `month` (yyyy-MM) is the cache key. */
export function useHistory(month: string, from: Date, to: Date) {
  return useQuery({
    queryKey: workoutKeys.history(month),
    queryFn: () => api.listSessionsBetween(from.toISOString(), to.toISOString()),
  })
}

// -----------------------------------------------------------------------------
// View helpers
// -----------------------------------------------------------------------------
/**
 * Workouts view of the user's weight unit (settings, kg default): set weights, totals, estimates.
 * Values are stored in kg; convert only for display/input. Rounding rules: src/lib/units.ts.
 */
export function useWeightUnit() {
  const u = useUnits()
  const { i18n } = useTranslation()
  const lang = i18n.resolvedLanguage === 'en' ? 'en' : 'tr'
  return useMemo(() => {
    const nf = new Intl.NumberFormat(lang, { maximumFractionDigits: 2 })
    return {
      /** 'kg' | 'lb' (code, for logic) */
      unit: u.weight,
      /** translated unit label for the UI */
      label: u.weightLabel,
      /** stepper increment: 2.5 kg / 5 lb */
      step: u.steps.load,
      /** stored kg -> number in the user's unit, rounded like it is shown */
      toDisplay: (kg: number) => u.kg(kg, 'load'),
      /** number in the user's unit -> kg (0.01 kg) */
      toKg: (value: number) => u.toKg(value, 'load'),
      /** 82.5 -> "82,5" (tr) / "82.5" (en), in the user's unit, no unit suffix */
      format: u.load,
      /** a stepper value that is already in the user's unit */
      formatValue: u.loadValue,
      /** large totals (volume): no decimals, grouped */
      formatTotal: u.volume,
      /** computed estimates (e1RM): not snapped to plate steps, one decimal */
      formatEstimate: u.estimate,
      /** plain numbers (RPE, km) */
      formatNumber: (n: number) => nf.format(n),
    }
  }, [u, lang])
}

export function useDateLocale() {
  const { i18n } = useTranslation()
  return i18n.resolvedLanguage === 'en' ? enUS : trLocale
}

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------
function useUserId(): string {
  const { user } = useAuth()
  return user?.id ?? ''
}

/** After anything that moves points: refresh workouts, the leaderboard and the profile (points/streak). */
function useAfterPoints() {
  const qc = useQueryClient()
  const { refreshProfile } = useAuth()
  return useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: workoutKeys.all }),
      qc.invalidateQueries({ queryKey: ['leaderboard'] }),
      // exercise pages: progress chart and "last sessions" list share the ['exercises','progress'] prefix
      qc.invalidateQueries({ queryKey: ['exercises', 'progress'] }),
      refreshProfile(),
    ])
  }, [qc, refreshProfile])
}

const previewId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()))

export function useSaveTemplate() {
  const qc = useQueryClient()
  const userId = useUserId()
  const preview = useIsPreview()
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: TemplateInput }) =>
      preview ? Promise.resolve(id ?? previewId()) : api.saveTemplate(userId, id, input),
    onSuccess: () => {
      if (!preview) void qc.invalidateQueries({ queryKey: workoutKeys.all })
    },
  })
}

export function useArchiveTemplate() {
  const qc = useQueryClient()
  const preview = useIsPreview()
  return useMutation({
    mutationFn: (id: string) => (preview ? Promise.resolve() : api.archiveTemplate(id)),
    onSuccess: () => {
      if (!preview) void qc.invalidateQueries({ queryKey: workoutKeys.all })
    },
  })
}

export function useStartSession() {
  const qc = useQueryClient()
  const userId = useUserId()
  const preview = useIsPreview()
  return useMutation({
    mutationFn: (template: TemplateWithExercises | null) => (preview ? Promise.resolve('preview') : api.startSession(userId, template)),
    onSuccess: () => {
      if (!preview) void qc.invalidateQueries({ queryKey: workoutKeys.active })
    },
  })
}

function patchBundle(qc: QueryClient, sessionId: string, fn: (exercises: BundleExercise[]) => BundleExercise[]) {
  qc.setQueryData<SessionBundle | null>(workoutKeys.session(sessionId), (prev) => (prev ? { ...prev, exercises: fn(prev.exercises) } : prev))
}

/**
 * Offline queue (src/lib/offline): the gym-critical session writes. Registered once on the QueryClient so
 * writes persisted while offline replay after a reload too. On success the server row (same id) goes into
 * the cache; until then the read hooks overlay the queued variables.
 */
export function registerWorkoutQueue(qc: QueryClient) {
  registerQueued<SessionSet, AddSetVars>(qc, workoutQueue.addSet, {
    mutationFn: (v) => api.addSet(v.userId, v),
    onSuccess: (row, v) => patchBundle(qc, v.sessionId, (list) => withSet(list, row)),
  })
  registerQueued<void, DeleteSetVars>(qc, workoutQueue.deleteSet, {
    mutationFn: (v) => api.deleteSet(v.setId),
    onSuccess: (_d, v) => patchBundle(qc, v.sessionId, (list) => withoutSet(list, v.setId)),
  })
  registerQueued<BundleExercise, AddExerciseVars>(qc, workoutQueue.addExercise, {
    mutationFn: (v) => api.addSessionExercise(v.userId, v),
    onSuccess: (row, v) => patchBundle(qc, v.sessionId, (list) => withExercise(list, row)),
  })
  registerQueued<FinishSummary, FinishVars>(qc, workoutQueue.finish, {
    mutationFn: (v) => api.finishSession(v.sessionId, v.emptyExerciseIds),
    onSuccess: (_d, v) => {
      // the overlay stops hiding the session once the write settles: close it in the cache first
      qc.setQueryData<WorkoutSession | null>(workoutKeys.active, (prev) => (prev?.id === v.sessionId ? null : prev))
      qc.setQueryData<SessionBundle | null>(workoutKeys.session(v.sessionId), (prev) =>
        prev && !prev.session.ended_at ? { ...prev, session: { ...prev.session, ended_at: v.at } } : prev,
      )
    },
    // exercise pages: progress chart and "last sessions" list share the ['exercises','progress'] prefix
    invalidates: [workoutKeys.all, ['exercises', 'progress']],
    points: true,
  })
}

/** Logs a set. Queued: shows at once (overlay), syncs in order, survives offline and reloads. */
export function useAddSet(sessionId: string) {
  const qc = useQueryClient()
  const userId = useUserId()
  const preview = useIsPreview()
  const stamp = useCallback((s: api.NewSet): AddSetVars => ({ ...s, id: newId(), userId, at: nowISO() }), [userId])
  return useQueuedMutation<SessionSet, api.NewSet, AddSetVars>(
    workoutQueue.addSet,
    stamp,
    preview
      ? {
          mutationFn: async (v) => ({ ...pendingSetRow(v), user_id: 'preview' }),
          onSuccess: (row) => patchBundle(qc, sessionId, (list) => withSet(list, row)),
        }
      : undefined,
  )
}

/** Removes a set; a set that never reached the server is simply dropped from the queue. */
export function useDeleteSet(sessionId: string) {
  const qc = useQueryClient()
  const userId = useUserId()
  const preview = useIsPreview()
  const stamp = useCallback((setId: string): DeleteSetVars => ({ sessionId, setId, userId, at: nowISO() }), [sessionId, userId])
  const m = useQueuedMutation<void, string, DeleteSetVars>(
    workoutQueue.deleteSet,
    stamp,
    preview
      ? { mutationFn: async () => undefined, onSuccess: (_d, v) => patchBundle(qc, sessionId, (list) => withoutSet(list, v.setId)) }
      : undefined,
  )
  const { mutate: queue } = m
  const mutate = useCallback(
    (setId: string, opts?: Parameters<typeof queue>[1]) => {
      if (!preview && cancelQueuedInsert(qc, workoutQueue.addSet, setId)) return stamp(setId)
      return queue(setId, opts)
    },
    [preview, qc, queue, stamp],
  )
  return { ...m, mutate }
}

export function useAddSessionExercise(sessionId: string) {
  const qc = useQueryClient()
  const userId = useUserId()
  const preview = useIsPreview()
  const stamp = useCallback(
    ({ exerciseId, existing }: { exerciseId: string; existing: BundleExercise[] }): AddExerciseVars => ({
      id: newId(),
      sessionId,
      exerciseId,
      position: nextPosition(existing),
      userId,
      at: nowISO(),
    }),
    [sessionId, userId],
  )
  return useQueuedMutation<BundleExercise, { exerciseId: string; existing: BundleExercise[] }, AddExerciseVars>(
    workoutQueue.addExercise,
    stamp,
    preview
      ? {
          mutationFn: async (v) => ({ ...pendingExerciseRow(v), user_id: 'preview' }),
          onSuccess: (row) => patchBundle(qc, sessionId, (list) => withExercise(list, row)),
        }
      : undefined,
  )
}

type FinishInput = { sessionId: string; emptyExerciseIds: string[] }

/**
 * Finish a session. Queued: offline the screen shows a local summary right away (see LiveSession) and the
 * server computes totals, points and PRs when the queue reaches it.
 */
export function useFinishSession() {
  const preview = useIsPreview()
  const userId = useUserId()
  const qc = useQueryClient()
  const stamp = useCallback((v: FinishInput): FinishVars => ({ ...v, userId, at: nowISO() }), [userId])
  return useQueuedMutation<FinishSummary, FinishInput, FinishVars>(
    workoutQueue.finish,
    stamp,
    preview
      ? {
          mutationFn: async ({ sessionId }) => {
            const summary = localFinishSummary(qc.getQueryData<SessionBundle | null>(workoutKeys.session(sessionId)) ?? null)
            return { ...summary, points_awarded: summary.total_sets ? Math.min(100, 50 + 2 * summary.total_sets) : 0 }
          },
        }
      : undefined,
  )
}

/** The server's summary of a finish that was queued (offline), once the queue has synced it. */
export function useFinishResult(sessionId: string): FinishSummary | undefined {
  const results = useMutationState({
    filters: { mutationKey: workoutQueue.finish, status: 'success', predicate: (m) => (m.state.variables as FinishVars | undefined)?.sessionId === sessionId },
    select: (m) => m.state.data as FinishSummary,
  })
  return results[results.length - 1]
}

/** What the device knows about a session before the server has closed it: totals, but no points or PRs yet. */
export function localFinishSummary(bundle: SessionBundle | null, now = Date.now()): FinishSummary {
  const sets = bundle?.exercises.flatMap((e) => e.sets) ?? []
  return {
    duration_sec: bundle ? Math.max(0, Math.round((now - new Date(bundle.session.started_at).getTime()) / 1000)) : 0,
    total_sets: workingSetCount(sets),
    total_volume_kg: sessionVolumeKg(sets),
    kcal_estimate: null,
    kcal_weight_kg: null,
    points_awarded: 0,
    new_prs: [],
  }
}

export function useDeleteSession() {
  const preview = useIsPreview()
  const afterPoints = useAfterPoints()
  return useMutation({
    mutationFn: (id: string) => (preview ? Promise.resolve() : api.deleteSession(id)),
    onSuccess: () => {
      if (!preview) void afterPoints()
    },
  })
}

export function useLogCardio() {
  const userId = useUserId()
  const preview = useIsPreview()
  const afterPoints = useAfterPoints()
  return useMutation({
    mutationFn: (input: CardioInput): Promise<FinishSummary> =>
      preview
        ? Promise.resolve({
            duration_sec: Math.round(input.minutes * 60),
            total_sets: 0,
            total_volume_kg: 0,
            kcal_estimate: null,
            kcal_weight_kg: null,
            points_awarded: Math.min(60, 30 + Math.floor(input.minutes / 5)),
            new_prs: [],
          })
        : api.logCardio(userId, input),
    onSuccess: () => {
      if (!preview) void afterPoints()
    },
  })
}
