import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { enUS, tr as trLocale } from 'date-fns/locale'
import { useAuth } from '@/features/auth/AuthProvider'
import { useUserSettings } from '@/features/settings/hooks'
import { toLocalDateISO } from '@/lib/dates'
import * as api from './api'
import {
  isoWeekday,
  kgToUnit,
  roundWeight,
  sessionVolumeKg,
  unitToKg,
  weightStep,
  workingSetCount,
  type WeightUnit,
} from './logic'
import { useIsPreview } from './previewContext'
import type { BundleExercise, CardioInput, FinishSummary, SessionBundle, SessionSet, TemplateInput, TemplateWithExercises } from './schema'

export const workoutKeys = {
  all: ['workouts'] as const,
  templates: ['workouts', 'templates'] as const,
  template: (id: string) => ['workouts', 'template', id] as const,
  today: (isodow: number, day: string) => ['workouts', 'today', isodow, day] as const,
  active: ['workouts', 'active'] as const,
  session: (id: string) => ['workouts', 'session', id] as const,
  last: (exerciseId: string) => ['workouts', 'last', exerciseId] as const,
  history: (month: string) => ['workouts', 'history', month] as const,
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------
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

export function useActiveSession() {
  return useQuery({ queryKey: workoutKeys.active, queryFn: api.getActiveSession })
}

export function useSessionBundle(id: string | undefined) {
  return useQuery({ queryKey: workoutKeys.session(id ?? ''), queryFn: () => api.getSessionBundle(id!), enabled: Boolean(id) })
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
/** Weight unit from settings (kg default). Values are stored in kg; convert only for display/input. */
export function useWeightUnit() {
  const { settings } = useUserSettings()
  const { i18n } = useTranslation()
  const unit: WeightUnit = settings?.unit_weight === 'lb' ? 'lb' : 'kg'
  const lang = i18n.resolvedLanguage === 'en' ? 'en' : 'tr'
  return useMemo(() => {
    const nf = new Intl.NumberFormat(lang, { maximumFractionDigits: 2 })
    const nf0 = new Intl.NumberFormat(lang, { maximumFractionDigits: 0 })
    const nf1 = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 })
    const toDisplay = (kg: number) => roundWeight(kgToUnit(kg, unit), unit)
    return {
      unit,
      step: weightStep(unit),
      toDisplay,
      toKg: (value: number) => unitToKg(value, unit),
      /** 82.5 -> "82,5" (tr) / "82.5" (en), in the user's unit, no unit suffix */
      format: (kg: number) => nf.format(toDisplay(kg)),
      /** large totals (volume): no decimals, grouped */
      formatTotal: (kg: number) => nf0.format(kgToUnit(kg, unit)),
      /** computed estimates (e1RM): not snapped to plate steps, one decimal */
      formatEstimate: (kg: number) => nf1.format(kgToUnit(kg, unit)),
      formatNumber: (n: number) => nf.format(n),
    }
  }, [unit, lang])
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

/** Logs a set; the cache is patched with the inserted row so the screen never waits for a refetch. */
export function useAddSet(sessionId: string) {
  const qc = useQueryClient()
  const userId = useUserId()
  const preview = useIsPreview()
  return useMutation({
    mutationFn: (s: api.NewSet): Promise<SessionSet> =>
      preview
        ? Promise.resolve({
            id: previewId(),
            session_id: s.sessionId,
            session_exercise_id: s.sessionExerciseId,
            user_id: 'preview',
            set_no: s.setNo,
            weight_kg: s.weightKg,
            reps: s.reps,
            rpe: s.rpe,
            is_warmup: s.isWarmup,
            completed_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
        : api.addSet(userId, s),
    onSuccess: (row) =>
      patchBundle(qc, sessionId, (list) =>
        list.map((ex) => (ex.id === row.session_exercise_id ? { ...ex, sets: [...ex.sets, row].sort((a, b) => a.set_no - b.set_no) } : ex)),
      ),
  })
}

export function useDeleteSet(sessionId: string) {
  const qc = useQueryClient()
  const preview = useIsPreview()
  return useMutation({
    mutationFn: (setId: string) => (preview ? Promise.resolve() : api.deleteSet(setId)),
    onSuccess: (_v, setId) => patchBundle(qc, sessionId, (list) => list.map((ex) => ({ ...ex, sets: ex.sets.filter((s) => s.id !== setId) }))),
  })
}

export function useAddSessionExercise(sessionId: string) {
  const qc = useQueryClient()
  const userId = useUserId()
  const preview = useIsPreview()
  return useMutation({
    mutationFn: ({ exerciseId, existing }: { exerciseId: string; existing: BundleExercise[] }): Promise<BundleExercise> =>
      preview
        ? Promise.resolve({
            id: previewId(),
            session_id: sessionId,
            user_id: 'preview',
            exercise_id: exerciseId,
            position: existing.reduce((m, e) => Math.max(m, e.position), -1) + 1,
            notes: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            sets: [],
            target: null,
          })
        : api.addSessionExercise(userId, sessionId, exerciseId, existing),
    onSuccess: (row) => patchBundle(qc, sessionId, (list) => [...list, row]),
  })
}

export function useFinishSession() {
  const preview = useIsPreview()
  const afterPoints = useAfterPoints()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sessionId, emptyExerciseIds }: { sessionId: string; emptyExerciseIds: string[] }): Promise<FinishSummary> => {
      if (!preview) return api.finishSession(sessionId, emptyExerciseIds)
      const bundle = qc.getQueryData<SessionBundle | null>(workoutKeys.session(sessionId))
      const sets = bundle?.exercises.flatMap((e) => e.sets) ?? []
      const total = workingSetCount(sets)
      return Promise.resolve({
        duration_sec: bundle ? Math.round((Date.now() - new Date(bundle.session.started_at).getTime()) / 1000) : 0,
        total_sets: total,
        total_volume_kg: sessionVolumeKg(sets),
        points_awarded: total ? Math.min(100, 50 + 2 * total) : 0,
        new_prs: [],
      })
    },
    onSuccess: () => {
      if (!preview) void afterPoints()
    },
  })
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
            points_awarded: Math.min(60, 30 + Math.floor(input.minutes / 5)),
            new_prs: [],
          })
        : api.logCardio(userId, input),
    onSuccess: () => {
      if (!preview) void afterPoints()
    },
  })
}
