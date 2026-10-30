// DEV ONLY (registered under /__dev/workouts in router.tsx behind import.meta.env.DEV).
// Renders the real workout screens against a pre-seeded query cache with sample data. The preview flag makes
// every mutation resolve locally, so nothing is ever written to Supabase from here.
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { addDays, addMonths, format, startOfMonth, subMinutes } from 'date-fns'
import { AppShell } from '@/app/AppShell'
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage'
import { exerciseKeys, type Exercise } from '@/features/exercises'
import { toLocalDateISO } from '@/lib/dates'
import { workoutKeys } from '../hooks'
import { draftKey, isoWeekday, type IsoWeekday } from '../logic'
import { WorkoutsPreviewContext } from '../previewContext'
import type { BundleExercise, FinishSummary, HistoryItem, SessionBundle, SessionSet, TemplateWithExercises } from '../schema'
import type { LastSet } from '../api'
import { LiveSession } from '../pages/LiveSessionPage'
import { SessionDetailPage } from '../pages/SessionDetailPage'
import { TemplateForm } from '../pages/TemplateEditorPage'
import { SessionSummary } from '../components/SessionSummary'

const NOW = new Date()
const iso = (d: Date) => d.toISOString()

const ex = (id: string, en: string, tr: string | null, target: string, equipment: string): Exercise => ({
  id,
  external_id: null,
  source: 'workout-guide',
  name_en: en,
  name_tr: tr,
  body_parts: ['chest'],
  target_muscles: [target],
  secondary_muscles: [],
  equipment: [equipment],
  instructions_en: [],
  instructions_tr: null,
  gif_path: null,
  media_frames: [],
  attribution: null,
  is_custom: false,
  user_id: null,
  created_at: iso(NOW),
  updated_at: iso(NOW),
})

const EX = {
  bench: ex('00000000-0000-4000-8000-000000000001', 'barbell bench press', 'Barbell bench press', 'pectorals', 'barbell'),
  incline: ex('00000000-0000-4000-8000-000000000002', 'dumbbell incline bench press', 'Eğimli dambıl press', 'pectorals', 'dumbbell'),
  ohp: ex('00000000-0000-4000-8000-000000000003', 'barbell standing military press', 'Ayakta askeri press', 'delts', 'barbell'),
  lateral: ex('00000000-0000-4000-8000-000000000004', 'dumbbell lateral raise', 'Yana dambıl kaldırma', 'delts', 'dumbbell'),
  pushdown: ex('00000000-0000-4000-8000-000000000005', 'cable pushdown', 'Kablo triceps itiş', 'triceps', 'cable'),
  row: ex('00000000-0000-4000-8000-000000000006', 'barbell bent over row', 'Barbell eğilerek çekiş', 'upper back', 'barbell'),
  pullup: ex('00000000-0000-4000-8000-000000000007', 'pull-up', 'Barfiks', 'lats', 'body weight'),
  squat: ex('00000000-0000-4000-8000-000000000008', 'barbell full squat', 'Barbell squat', 'glutes', 'barbell'),
}

function tplEx(templateId: string, e: Exercise, position: number, sets: number, low: number, high: number, rest: number) {
  return {
    id: `${templateId}-te-${position}`,
    template_id: templateId,
    user_id: 'preview',
    exercise_id: e.id,
    position,
    target_sets: sets,
    target_reps_low: low,
    target_reps_high: high,
    rest_seconds: rest,
    notes: null,
    created_at: iso(NOW),
    updated_at: iso(NOW),
  }
}

function template(id: string, name: string, weekdays: number[], items: ReturnType<typeof tplEx>[]): TemplateWithExercises {
  return { id, user_id: 'preview', name, notes: null, color: null, sort_order: 0, archived: false, weekdays, created_at: iso(NOW), updated_at: iso(NOW), template_exercises: items }
}

function buildTemplates(today: IsoWeekday, todayMode: string): TemplateWithExercises[] {
  const pushDays = todayMode === 'plan' || todayMode === 'active' ? [...new Set([1, 4, today])] : [1, 4].filter((d) => d !== today)
  const others = (days: number[]) => (todayMode === 'plan' || todayMode === 'active' ? days : days.filter((d) => d !== today))
  return [
    template('tpl-push', 'İtiş: göğüs, omuz', pushDays, [
      tplEx('tpl-push', EX.bench, 0, 4, 6, 8, 150),
      tplEx('tpl-push', EX.incline, 1, 3, 8, 12, 90),
      tplEx('tpl-push', EX.ohp, 2, 3, 6, 10, 120),
      tplEx('tpl-push', EX.lateral, 3, 3, 12, 15, 60),
      tplEx('tpl-push', EX.pushdown, 4, 3, 10, 12, 60),
    ]),
    template('tpl-pull', 'Çekiş: sırt, biceps', others([2, 5]), [tplEx('tpl-pull', EX.row, 0, 4, 6, 10, 120), tplEx('tpl-pull', EX.pullup, 1, 3, 6, 10, 120)]),
    template('tpl-legs', 'Bacak', others([3]), [tplEx('tpl-legs', EX.squat, 0, 5, 5, 5, 180)]),
    template('tpl-core', 'Karın (serbest)', [], [tplEx('tpl-core', EX.pullup, 0, 3, 10, 15, 45)]),
  ]
}

const set = (seId: string, n: number, kg: number | null, reps: number, opts: Partial<SessionSet> = {}): SessionSet => ({
  id: `${seId}-s${n}${opts.is_warmup ? 'w' : ''}`,
  session_exercise_id: seId,
  session_id: 'preview',
  user_id: 'preview',
  set_no: n,
  weight_kg: kg,
  reps,
  rpe: null,
  is_warmup: false,
  completed_at: iso(NOW),
  created_at: iso(NOW),
  updated_at: iso(NOW),
  ...opts,
})

function liveBundle(push: TemplateWithExercises, id: string, withExercises: boolean): SessionBundle {
  const items = withExercises ? push.template_exercises : []
  const exercises: BundleExercise[] = items.map((te, i) => {
    const seId = `${id}-se-${i}`
    const sets =
      i === 0
        ? [set(seId, 1, 60, 10, { is_warmup: true }), set(seId, 2, 82.5, 8, { rpe: 8 }), set(seId, 3, 82.5, 7, { rpe: 9 }), set(seId, 4, 80, 7), set(seId, 5, 80, 6)]
        : i === 1
          ? [set(seId, 1, 30, 10)]
          : []
    return { id: seId, session_id: id, user_id: 'preview', exercise_id: te.exercise_id, position: te.position, notes: null, created_at: iso(NOW), updated_at: iso(NOW), sets, target: te }
  })
  return {
    session: {
      id,
      user_id: 'preview',
      template_id: withExercises ? push.id : null,
      kind: 'strength',
      title: withExercises ? push.name : null,
      started_at: iso(subMinutes(NOW, 34)),
      ended_at: null,
      duration_sec: null,
      notes: null,
      total_volume_kg: 0,
      total_sets: 0,
      kcal_estimate: null,
      kcal_weight_kg: null,
      created_at: iso(NOW),
      updated_at: iso(NOW),
    },
    templateName: withExercises ? push.name : null,
    exercises,
    cardio: [],
  }
}

const last = (sets: [number | null, number][], warmup?: [number, number]): LastSet[] => [
  ...(warmup ? [{ set_no: 0, weight_kg: warmup[0], reps: warmup[1], rpe: null, is_warmup: true, started_at: iso(addDays(NOW, -4)) }] : []),
  ...sets.map(([kg, reps], i) => ({ set_no: i + 1, weight_kg: kg, reps, rpe: null, is_warmup: false, started_at: iso(addDays(NOW, -4)) })),
]

function historyItems(month: Date): HistoryItem[] {
  const base = startOfMonth(month)
  const mk = (day: number, h: number, item: Partial<HistoryItem>): HistoryItem => {
    const started = new Date(base.getFullYear(), base.getMonth(), day, h, 10)
    return {
      id: `h-${day}-${h}`,
      kind: 'strength',
      title: null,
      started_at: iso(started),
      ended_at: iso(new Date(started.getTime() + 3_000_000)),
      duration_sec: 3120,
      total_sets: 18,
      total_volume_kg: 8420,
      kcal_estimate: 364,
      template_id: 'tpl-push',
      templateName: 'İtiş: göğüs, omuz',
      cardio: [],
      ...item,
    }
  }
  const today = NOW.getDate()
  const days = [2, 3, 5, 9, 10, 12, 16, 17, 19, 23].filter((d) => d <= today)
  return days
    .map((d, i) =>
      i % 4 === 3
        ? mk(d, 7, { kind: 'cardio', templateName: null, template_id: null, duration_sec: 1860, total_sets: 0, total_volume_kg: 0, cardio: [{ activity: 'run', duration_sec: 1860, distance_m: 5200 }] })
        : i % 3 === 1
          ? mk(d, 18, { templateName: 'Çekiş: sırt, biceps', template_id: 'tpl-pull', total_sets: 14, total_volume_kg: 6150, duration_sec: 2700 })
          : mk(d, 19, {}),
    )
    .reverse()
}

function detailBundle(): SessionBundle {
  const b = liveBundle(buildTemplates(1, 'plan')[0], 'detail-1', true)
  const started = addDays(NOW, -2)
  return {
    ...b,
    session: { ...b.session, started_at: iso(started), ended_at: iso(new Date(started.getTime() + 3_120_000)), duration_sec: 3120, total_sets: 5, total_volume_kg: 2765, kcal_estimate: 364, kcal_weight_kg: 78 },
  }
}

function seed(todayMode: string): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnMount: false } },
  })
  const today = isoWeekday()
  const templates = todayMode === 'none' ? [] : buildTemplates(today, todayMode)
  // Sample illustration frames resolve to /dev-media.local/ (gitignored); missing files leave the plate empty.
  for (const e of Object.values(EX)) {
    e.media_frames = [1, 2, 3].map((n) => `frames/bench-press/${n}.svg`)
    for (const p of e.media_frames) qc.setQueryData(exerciseKeys.media(p), '/dev-media.local/' + p)
  }
  qc.setQueryData(workoutKeys.templates, templates)
  qc.setQueryData(
    workoutKeys.today(today, toLocalDateISO()),
    templates.filter((t) => t.weekdays.includes(today)),
  )
  const push = buildTemplates(today, 'plan')[0]
  const live = liveBundle(push, 'preview', true)
  qc.setQueryData(workoutKeys.active, todayMode === 'active' ? live.session : null)
  qc.setQueryData(workoutKeys.session('preview'), live)
  qc.setQueryData(workoutKeys.session('preview-empty'), liveBundle(push, 'preview-empty', false))
  qc.setQueryData(workoutKeys.session('detail-1'), detailBundle())
  qc.setQueryData(workoutKeys.template('tpl-push'), push)

  const all = Object.values(EX)
  const seedMany = (ids: string[]) => qc.setQueryData(exerciseKeys.many([...new Set(ids)]), all.filter((e) => ids.includes(e.id)))
  for (const t of buildTemplates(today, 'plan')) seedMany(t.template_exercises.map((x) => x.exercise_id))
  seedMany(live.exercises.map((e) => e.exercise_id))

  qc.setQueryData(workoutKeys.last(EX.bench.id), last([[80, 8], [80, 8], [80, 7], [77.5, 8]], [60, 10]))
  qc.setQueryData(workoutKeys.last(EX.incline.id), last([[30, 10], [30, 9], [27.5, 10]]))
  qc.setQueryData(workoutKeys.last(EX.ohp.id), last([[50, 8], [50, 7], [47.5, 8]]))
  qc.setQueryData(workoutKeys.last(EX.lateral.id), [])
  qc.setQueryData(workoutKeys.last(EX.pushdown.id), last([[25, 12], [25, 11], [25, 10]]))

  for (let i = 0; i < 3; i++) {
    const m = addMonths(startOfMonth(NOW), -i)
    qc.setQueryData(workoutKeys.history(format(m, 'yyyy-MM')), i === 2 ? [] : historyItems(i === 0 ? m : new Date(m.getFullYear(), m.getMonth(), 28)))
  }
  return qc
}

/** Layout route: sample cache + preview flag + the normal app frame (tab bar). ?today=plan|rest|none|active */
export function DevWorkoutsLayout() {
  const [params] = useSearchParams()
  const [client] = useState(() => seed(params.get('today') ?? 'plan'))
  return (
    <QueryClientProvider client={client}>
      <WorkoutsPreviewContext.Provider value={true}>
        <AppShell />
      </WorkoutsPreviewContext.Provider>
    </QueryClientProvider>
  )
}

export function DevTemplateEditor() {
  const [params] = useSearchParams()
  const today = isoWeekday()
  return <TemplateForm template={params.get('new') ? null : buildTemplates(today, 'plan')[0]} />
}

export function DevDashboard() {
  return <DashboardPage preview={{ points: 1240, streak: 9, energy: { burned: { kcal: 412, sessions: 1 }, eaten: { kcal: 1640, entries: 6 } } }} />
}

export function DevSessionDetail() {
  return <SessionDetailPage sessionId="detail-1" />
}

const SAMPLE_SUMMARY: FinishSummary = {
  duration_sec: 3127,
  total_sets: 16,
  total_volume_kg: 7845,
  points_awarded: 98,
  new_prs: [
    { exercise_id: EX.bench.id, e1rm: 104.5, weight_kg: 82.5, reps: 8 },
    { exercise_id: EX.ohp.id, e1rm: 63.33, weight_kg: 50, reps: 8 },
  ],
  kcal_estimate: 412,
  kcal_weight_kg: null,
}

/** ?state=entry (default) | rest | empty | summary */
export function DevLiveSession() {
  const [params] = useSearchParams()
  const state = params.get('state') ?? 'entry'
  const [ready] = useState(() => {
    const draft =
      state === 'rest'
        ? { v: 1, exerciseIndex: 1, restEndsAt: Date.now() + 75_000, restTotalSec: 90, skipped: [] }
        : { v: 1, exerciseIndex: state === 'first' ? 0 : 1, restEndsAt: null, restTotalSec: null, skipped: [] }
    window.localStorage.setItem(draftKey(state === 'empty' ? 'preview-empty' : 'preview'), JSON.stringify(draft))
    return true
  })
  if (!ready) return null
  if (state === 'summary') {
    const names = new Map(Object.values(EX).map((e) => [e.id, e.name_tr ?? e.name_en]))
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-bg">
        <SessionSummary title="İtiş: göğüs, omuz" summary={SAMPLE_SUMMARY} exerciseLabel={(id) => names.get(id) ?? id} onDone={() => history.back()} />
      </div>
    )
  }
  return <LiveSession sessionId={state === 'empty' ? 'preview-empty' : 'preview'} />
}
