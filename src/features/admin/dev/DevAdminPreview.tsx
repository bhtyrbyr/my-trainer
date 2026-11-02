// DEV ONLY (registered under /__dev/admin in router.tsx behind import.meta.env.DEV).
// Access and Users against a seeded cache; AdminPreviewContext keeps queries off the network and makes
// every mutation edit the cache only. ?mode=invite starts in invite-only mode. ExerciseDB: tapping a row
// opens the picker with sample hits (exercisedbSamples.ts); saving only edits the cache.
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from '@/app/AppShell'
import { adminKeys } from '../hooks'
import type { AdminConfig } from '../adminLogic'
import { exerciseKeys, type Exercise } from '@/features/exercises'
import type { AdminUser, MatchRow } from '../api'
import type { MatchCounts } from '../exercisedbLogic'
import { AdminPreviewContext } from '../previewContext'
import { seedExerciseDbSearch } from './exercisedbSamples'

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
const day = (days: number) => ago(days).slice(0, 10)

const user = (n: number, over: Partial<AdminUser>): AdminUser => ({
  user_id: `00000000-0000-4000-8000-00000000000${n}`,
  username: `user${n}`,
  display_name: `User ${n}`,
  email: `user${n}@example.com`,
  status: 'approved',
  role: 'user',
  is_blocked: false,
  created_at: ago(n * 9),
  last_active_on: day(n),
  ai_daily_limit: 40,
  avatar_path: '',
  ...over,
})

type SampleRow = [name: string, bodyParts: string[], equipment: string[], source: string, target: string[], secondary: string[]]

const UNMATCHED: SampleRow[] = [
  ['alternating kettlebell floor press', ['chest'], ['kettlebell'], 'wger', ['pectorals'], ['triceps', 'deltoids']],
  ['band pull-apart with external rotation', ['shoulders'], ['resistance band'], 'wger', ['deltoids'], ['upper back']],
  ['bench press with pause', ['chest'], ['barbell'], 'wger', ['pectorals'], ['triceps', 'deltoids']],
  ['bear crawl', ['waist'], ['bodyweight'], 'workout-guide', ['abs'], ['deltoids', 'quads']],
  ['cossack squat', ['upper legs'], ['bodyweight'], 'wger', ['quads'], ['glutes', 'adductors']],
  ['copenhagen plank', ['upper legs'], ['bodyweight'], 'wger', ['adductors'], ['abs']],
  ['dead bug with band', ['waist'], ['resistance band'], 'wger', ['abs'], []],
  ['farmer carry', ['lower arms'], ['dumbbell'], 'workout-guide', ['forearms'], ['trapezius', 'abs']],
  ['jefferson curl', ['back'], ['barbell'], 'wger', ['erector spinae'], ['hamstrings']],
  ['landmine rotation', ['waist'], ['olympic barbell'], 'wger', ['abs'], ['deltoids']],
  ['nordic hamstring curl', ['upper legs'], ['bodyweight'], 'wger', ['hamstrings'], ['glutes']],
  ['pallof press', ['waist'], ['cable'], 'wger', ['abs'], []],
  ['reverse nordic', ['upper legs'], ['bodyweight'], 'wger', ['quads'], []],
  ['sissy squat', ['upper legs'], ['bodyweight'], 'workout-guide', ['quads'], []],
  ['suitcase carry', ['waist'], ['kettlebell'], 'wger', ['abs'], ['forearms']],
  ['tibialis raise', ['lower legs'], ['weighted'], 'wger', ['shins'], []],
  ['turkish get-up', ['waist'], ['kettlebell'], 'wger', ['abs'], ['deltoids', 'glutes']],
]

/** AI matches to review (real ExerciseDB ids; one of them plainly wrong). */
const AI_MATCHED: [...SampleRow, gif: string][] = [
  ['bench press wide grip', ['chest'], ['barbell'], 'wger', ['pectorals'], ['triceps'], 'EIeI8Vf'],
  ['chin-up', ['back'], ['bodyweight'], 'wger', ['latissimus dorsi'], ['biceps'], 'lBDjFxJ'],
  ['goblet squat', ['upper legs'], ['kettlebell'], 'workout-guide', ['quads'], ['glutes'], 'qXTaZnJ'],
  ['rope triceps pushdown', ['upper arms'], ['cable'], 'wger', ['triceps'], [], '3ZflifB'],
  ['romanian deadlift', ['upper legs'], ['barbell'], 'wger', ['hamstrings'], ['glutes'], 'ila4NZS'],
  ['hip thrust', ['upper legs'], ['barbell'], 'wger', ['glutes'], ['hamstrings'], 'ila4NZS'],
]

const sampleId = (group: number, i: number) => `00000000-0000-4000-900${group}-${String(i).padStart(12, '0')}`

function matchRow([name_en, body_parts, equipment, source, target_muscles, secondary_muscles]: SampleRow | [...SampleRow, string], id: string, gif: string | null): MatchRow {
  return { id, name_en, body_parts, equipment, source, target_muscles, secondary_muscles, media_frames: [], exercisedb_id: gif, exercisedb_match: gif ? 'ai' : null }
}

/** ExerciseDB match counts, the first page of both worklists and the rows by id (?all=1: everything matched). */
function seedExerciseDb(qc: QueryClient, allMatched: boolean) {
  const rows = allMatched ? [] : UNMATCHED.map((r, i) => matchRow(r, sampleId(0, i), null))
  const ai = AI_MATCHED.map((r, i) => matchRow(r, sampleId(1, i), r[6]))
  const total = allMatched ? 0 : 137
  qc.setQueryData<MatchCounts>(adminKeys.exercisedbCounts, { exact: 318, fuzzy: 104, ai: 41, manual: 6, unmatched: total })
  qc.setQueryData(adminKeys.exercisedbList('unmatched', ''), { pages: [{ rows, total }], pageParams: [0] })
  qc.setQueryData(adminKeys.exercisedbList('ai', ''), { pages: [{ rows: ai, total: 41 }], pageParams: [0] })
  for (const r of [...rows, ...ai]) {
    qc.setQueryData<Exercise>(exerciseKeys.one(r.id), {
      ...r,
      external_id: null,
      name_tr: null,
      instructions_en: [],
      instructions_tr: null,
      attribution: null,
      exercisedb_match: r.exercisedb_id ? 'ai' : null,
      is_custom: false,
      user_id: null,
      created_at: '2026-10-25T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    })
  }
  seedExerciseDbSearch(qc)
}

function seed(mode: string | null, allMatched = false): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnMount: false } },
  })
  qc.setQueryData<AdminConfig>(adminKeys.config, {
    access_mode: mode === 'invite' ? 'invite' : 'open',
    require_approval: true,
    ai_global_daily_limit: 200,
  })
  qc.setQueryData(adminKeys.allowed, [
    { email: 'ayse.yilmaz@example.com', note: 'Spor salonu', added_by: 'a', added_by_username: 'bahtiyar', created_at: ago(2) },
    { email: 'mehmet.kaya@example.com', note: '', added_by: 'a', added_by_username: 'bahtiyar', created_at: ago(11) },
    { email: 'zeynep@example.org', note: 'Kardeşim', added_by: 'a', added_by_username: 'bahtiyar', created_at: ago(25) },
  ])
  qc.setQueryData<AdminUser[]>(adminKeys.users(''), [
    user(1, { username: 'ayse', display_name: 'Ayşe Yılmaz', email: 'ayse.yilmaz@example.com', last_active_on: day(0) }),
    user(2, { username: 'mehmet', display_name: 'Mehmet Kaya', email: 'mehmet.kaya@example.com', status: 'pending', last_active_on: null, ai_daily_limit: null }),
    user(3, { username: 'can', display_name: 'Can Demir', email: 'can.demir@example.com', is_blocked: true, ai_daily_limit: 0 }),
    user(4, { username: 'bahtiyar', display_name: 'Bahtiyar', email: 'admin@example.com', role: 'admin', ai_daily_limit: 100 }),
    user(5, { username: 'zeynep', display_name: 'Zeynep Ak', email: 'zeynep@example.org' }),
  ])
  qc.setQueryData(adminKeys.aiApp, { used: 37, limit: 200 })
  seedExerciseDb(qc, allMatched)
  return qc
}

/** Layout route: sample cache + preview flag + the normal app frame (tab bar). */
export function DevAdminLayout() {
  const [params] = useSearchParams()
  const [client] = useState(() => seed(params.get('mode'), params.get('all') === '1'))
  return (
    <QueryClientProvider client={client}>
      <AdminPreviewContext.Provider value={true}>
        <AppShell />
      </AdminPreviewContext.Provider>
    </QueryClientProvider>
  )
}
