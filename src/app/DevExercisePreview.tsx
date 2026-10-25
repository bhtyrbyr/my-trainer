import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { exerciseKeys } from '@/features/exercises/hooks'
import { muscleMapPaths, resolveMuscleMap, type MuscleCatalog } from '@/features/exercises/muscles'
import type { LoggedSet, ProgressPoint } from '@/features/exercises/progress'
import type { Exercise } from '@/features/exercises/types'
import { ExerciseLibraryPage } from '@/features/exercises/pages/ExerciseLibraryPage'
import { ExerciseDetailPage } from '@/features/exercises/pages/ExerciseDetailPage'

/**
 * Dev-only previews of the exercise library and detail screens without a session: the TanStack Query
 * cache is seeded with sample rows before the real pages render (no preview props in the pages).
 * Media resolves to `/dev-media.local/...` (gitignored); drop wger SVGs (muscles/front.svg, back.svg,
 * main/<id>.svg, secondary/<id>.svg) and a few ExerciseDB GIFs (gifs/<id>.gif) there to see images.
 *   /__dev/exercises             library
 *   /__dev/exercises/sample-bench detail with progress   (?empty=1 for the "no sessions yet" state)
 */
const MEDIA_BASE = '/dev-media.local/'

const ex = (
  id: string,
  external: string,
  name_en: string,
  name_tr: string | null,
  body_parts: string[],
  target_muscles: string[],
  secondary_muscles: string[],
  equipment: string[],
  gif = true,
): Exercise => ({
  id,
  external_id: external,
  source: 'exercisedb',
  name_en,
  name_tr,
  body_parts,
  target_muscles,
  secondary_muscles,
  equipment,
  instructions_en: [
    'Settle onto a bench with your feet planted and your back pressed against the bench.',
    'Hold the barbell with palms facing down just beyond shoulder width.',
    'Brace the torso and align the wrists with the forearms.',
    'Press the weight or handles away while keeping your trunk braced.',
    'Keep the wrists stacked and use a shoulder path that feels natural.',
    'Lower the weight to its starting height under control before pressing again.',
  ],
  instructions_tr: null,
  gif_path: gif ? `gifs/${external}.gif` : null,
  is_custom: false,
  user_id: null,
  created_at: '2026-10-25T00:00:00Z',
  updated_at: '2026-10-25T00:00:00Z',
})

const EXERCISES: Exercise[] = [
  ex('sample-bench', 'EIeI8Vf', 'barbell bench press', 'Halter Bench Press', ['chest'], ['pectorals'], ['triceps', 'deltoids', 'rotator cuff'], ['barbell']),
  ex('sample-deadlift', 'ila4NZS', 'barbell deadlift', 'Halter Deadlift', ['upper legs'], ['glutes'], ['hamstrings', 'erector spinae'], ['barbell']),
  ex('sample-squat', 'qXTaZnJ', 'barbell full squat', 'Halter Squat', ['upper legs'], ['glutes'], ['quadriceps', 'hamstrings', 'calves', 'core'], ['barbell']),
  ex('sample-pushdown', '3ZflifB', 'cable pushdown', 'Kablo Triceps Pushdown', ['upper arms'], ['triceps'], ['forearms'], ['cable']),
  ex('sample-row', 'A3P4O0R', 'cable seated row', 'Oturarak Kablo Row', ['back'], ['upper back'], ['biceps', 'forearms'], ['cable'], false),
  ex('sample-incline', 'ns0SIbU', 'dumbbell incline bench press', 'Incline Dambıl Bench Press', ['chest'], ['pectorals'], ['deltoids', 'triceps'], ['dumbbell']),
  ex('sample-lateral', 'DsgkuIt', 'dumbbell lateral raise', 'Dambıl Yan Açış (Lateral Raise)', ['shoulders'], ['deltoids'], ['trapezius'], ['dumbbell']),
  ex('sample-pullup', 'lBDjFxJ', 'pull-up', 'Barfiks', ['back'], ['latissimus dorsi'], ['biceps', 'forearms'], ['bodyweight']),
  ex('sample-pushup', 'I4hDWkc', 'push-up', 'Şınav', ['chest'], ['pectorals'], ['triceps', 'deltoids', 'core'], ['bodyweight']),
]

const WGER: [number, string, boolean][] = [
  [1, 'Biceps brachii', true], [2, 'Anterior deltoid', true], [3, 'Serratus anterior', true], [4, 'Pectoralis major', true],
  [5, 'Triceps brachii', false], [6, 'Rectus abdominis', true], [7, 'Gastrocnemius', false], [8, 'Gluteus maximus', false],
  [9, 'Trapezius', false], [10, 'Quadriceps femoris', true], [11, 'Biceps femoris', false], [12, 'Latissimus dorsi', false],
  [13, 'Brachialis', true], [14, 'Obliquus externus abdominis', true], [15, 'Soleus', false],
]
const CATALOG: MuscleCatalog = {
  muscles: WGER.map(([id, latin, front]) => ({
    wger_id: id,
    name_latin: latin,
    name_en: latin,
    name_tr: null,
    is_front: front,
    svg_main_path: `muscles/main/${id}.svg`,
    svg_secondary_path: `muscles/secondary/${id}.svg`,
  })),
  aliases: {
    abdominals: 6, abductors: 8, back: 12, biceps: 1, brachialis: 13, calves: 7, core: 6, deltoids: 2, forearms: 13,
    glutes: 8, hamstrings: 11, 'hip flexors': 10, 'latissimus dorsi': 12, obliques: 14, pectorals: 4, quadriceps: 10,
    'rear deltoids': 9, rhomboids: 9, 'serratus anterior': 3, soleus: 15, trapezius: 9, triceps: 5, 'upper back': 9,
    'rotator cuff': null, 'erector spinae': null, adductors: null,
  },
}

/** ~3 months of bench sessions, newest last; avg climbs with a deload dip. */
function sampleProgress(now: Date): ProgressPoint[] {
  const days = [86, 79, 72, 65, 58, 51, 44, 37, 30, 23, 16, 9, 5, 2]
  const avg = [55, 56, 57.5, 57.5, 58, 60, 60, 52.5, 60, 61, 62.5, 62.5, 63.5, 65]
  return days.map((d, i) => {
    const a = avg[i]
    const best = a + (i % 3 === 0 ? 5 : 2.5)
    return {
      session_id: `p${i}`,
      started_at: new Date(now.getTime() - d * 86_400_000).toISOString(),
      avg_weight_kg: a,
      best_weight_kg: best,
      best_e1rm: Math.round(best * (1 + 6 / 30) * 10) / 10,
      best_reps: 8,
      total_volume_kg: a * 8 * 4,
      total_sets: 4,
    }
  })
}

function sampleSets(now: Date): LoggedSet[] {
  const session = (n: number, daysAgo: number, sets: [number | null, number, boolean?][]): LoggedSet[] =>
    sets.map(([w, r, warm], i) => ({
      session_id: `p${n}`,
      started_at: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
      set_id: `p${n}-${i}`,
      set_no: i + 1,
      weight_kg: w,
      reps: r,
      rpe: null,
      is_warmup: Boolean(warm),
    }))
  return [
    ...session(13, 2, [[40, 12, true], [62.5, 8], [65, 8], [65, 7], [67.5, 6]]),
    ...session(12, 5, [[40, 12, true], [62.5, 8], [62.5, 8], [62.5, 8], [65, 6]]),
    ...session(11, 9, [[60, 10], [62.5, 8], [62.5, 8], [65, 5]]),
    ...session(10, 16, [[60, 10], [60, 10], [62.5, 8], [65, 6]]),
  ]
}

function Seed({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const empty = params.get('empty') === '1'
  // seed synchronously on first render so the real pages never fetch
  useState(() => {
    const now = new Date()
    qc.setQueryData(exerciseKeys.search({ q: '' }), { pages: [EXERCISES], pageParams: [0] })
    qc.setQueryData(exerciseKeys.facets, {
      bodyParts: ['back', 'cardio', 'chest', 'lower arms', 'lower legs', 'neck', 'shoulders', 'upper arms', 'upper legs', 'waist'],
      muscles: ['abdominals', 'biceps', 'calves', 'deltoids', 'glutes', 'hamstrings', 'latissimus dorsi', 'pectorals', 'quadriceps', 'triceps', 'upper back'],
      equipment: ['EZ bar', 'barbell', 'bodyweight', 'cable', 'dumbbell', 'kettlebell', 'leverage machine', 'smith machine'],
    })
    for (const e of EXERCISES) {
      qc.setQueryData(exerciseKeys.one(e.id), e)
      if (e.gif_path) qc.setQueryData(exerciseKeys.media(e.gif_path), MEDIA_BASE + e.gif_path)
    }
    qc.setQueryData(exerciseKeys.muscles, CATALOG)
    for (const e of EXERCISES) {
      const paths = muscleMapPaths(resolveMuscleMap(e.target_muscles, e.secondary_muscles, CATALOG))
      qc.setQueryData(exerciseKeys.mediaBatch(paths), Object.fromEntries(paths.map((p) => [p, MEDIA_BASE + p])))
      qc.setQueryData(exerciseKeys.progress(e.id), empty || e.id !== 'sample-bench' ? [] : sampleProgress(now))
      qc.setQueryData(exerciseKeys.recentSets(e.id, 10), empty || e.id !== 'sample-bench' ? [] : sampleSets(now))
    }
    return true
  })
  return <>{children}</>
}

export function DevExerciseLibraryPreview() {
  return (
    <Seed>
      <ExerciseLibraryPage />
    </Seed>
  )
}

export function DevExerciseDetailPreview() {
  return (
    <Seed>
      <ExerciseDetailPage />
    </Seed>
  )
}
