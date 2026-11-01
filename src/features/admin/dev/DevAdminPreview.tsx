// DEV ONLY (registered under /__dev/admin in router.tsx behind import.meta.env.DEV).
// Access and Users against a seeded cache; AdminPreviewContext keeps queries off the network and makes
// every mutation edit the cache only. ?mode=invite starts in invite-only mode.
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from '@/app/AppShell'
import { adminKeys } from '../hooks'
import type { AdminConfig } from '../adminLogic'
import type { AdminUser, UnmatchedExercise } from '../api'
import type { MatchCounts } from '../exercisedbLogic'
import { AdminPreviewContext } from '../previewContext'

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

const UNMATCHED: [string, string[], string[], string][] = [
  ['alternating kettlebell floor press', ['chest'], ['kettlebell'], 'wger'],
  ['band pull-apart with external rotation', ['shoulders'], ['resistance band'], 'wger'],
  ['bear crawl', ['waist'], ['bodyweight'], 'workout-guide'],
  ['cossack squat', ['upper legs'], ['bodyweight'], 'wger'],
  ['copenhagen plank', ['upper legs'], ['bodyweight'], 'wger'],
  ['dead bug with band', ['waist'], ['resistance band'], 'wger'],
  ['farmer carry', ['lower arms'], ['dumbbell'], 'workout-guide'],
  ['jefferson curl', ['back'], ['barbell'], 'wger'],
  ['landmine rotation', ['waist'], ['olympic barbell'], 'wger'],
  ['nordic hamstring curl', ['upper legs'], ['bodyweight'], 'wger'],
  ['pallof press', ['waist'], ['cable'], 'wger'],
  ['reverse nordic', ['upper legs'], ['bodyweight'], 'wger'],
  ['sissy squat', ['upper legs'], ['bodyweight'], 'workout-guide'],
  ['suitcase carry', ['waist'], ['kettlebell'], 'wger'],
  ['tibialis raise', ['lower legs'], ['weighted'], 'wger'],
  ['turkish get-up', ['waist'], ['kettlebell'], 'wger'],
]

/** ExerciseDB match counts and the first page of unmatched rows (?all=1: everything matched). */
function seedExerciseDb(qc: QueryClient, allMatched: boolean) {
  const rows: UnmatchedExercise[] = allMatched
    ? []
    : UNMATCHED.map(([name_en, body_parts, equipment, source], i) => ({ id: `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`, name_en, body_parts, equipment, source }))
  const total = allMatched ? 0 : 137
  qc.setQueryData<MatchCounts>(adminKeys.exercisedbCounts, { exact: 318, fuzzy: 104, ai: 41, manual: 6, unmatched: total })
  qc.setQueryData(adminKeys.exercisedbUnmatched(''), { pages: [{ rows, total }], pageParams: [0] })
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
