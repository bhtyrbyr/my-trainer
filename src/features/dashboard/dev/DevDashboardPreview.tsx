// DEV ONLY (registered under /__dev/home in router.tsx behind import.meta.env.DEV).
// Home against a seeded query cache. Preview contexts keep every query off the network and make the
// water quick-add local, so nothing is written to Supabase from here.
//   ?hour=21 (default) streak + habits nudges · ?hour=12 muscle + weigh-in · ?health=0 without consent
//   ?empty=1 a fresh week · ?celebrate=streak_7 the badge sheet · ?units=imperial
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from '@/app/AppShell'
import { useAuth } from '@/features/auth/AuthProvider'
import { BADGES, BadgesPreviewContext, type BadgeCode } from '@/features/badges'
import { BodyPreviewContext, bodyKeys, type BodyMetric } from '@/features/body'
import { NutritionPreviewContext } from '@/features/nutrition'
import { settingsKeys } from '@/features/settings/hooks'
import { SleepWaterPreviewContext, sleepWaterKeys } from '@/features/sleepwater'
import { todayKeys } from '@/features/today'
import { workoutKeys } from '@/features/workouts'
import { WorkoutsPreviewContext } from '@/features/workouts/previewContext'
import { isoWeekday } from '@/features/workouts/logic'
import { toLocalDateISO } from '@/lib/dates'
import { addDays } from '@/lib/recurrence'
import type { UserSettings } from '@/lib/database.types'
import { dashboardKeys } from '../hooks'
import { weekStartOf } from '../logic'
import { DashboardPage } from '../pages/DashboardPage'
import { DashboardPreviewContext } from '../previewContext'
import type { WeekSummary } from '../schema'

const HISTORY_DAYS = 120 // mirrors today/types.ts (logs query key)

function seed(params: URLSearchParams, userId: string): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnMount: false } },
  })
  const today = toLocalDateISO()
  const empty = params.get('empty') === '1'
  const now = new Date().toISOString()

  const week: WeekSummary = empty
    ? { week_start: weekStartOf(today), workouts: 0, sets: 0, volume_kg: 0, cardio_minutes: 0, habit_rate: null, todos_done: 0, avg_sleep_minutes: null, weight_change_kg: null, water_goal_days: null }
    : { week_start: weekStartOf(today), workouts: 3, sets: 46, volume_kg: 9240, cardio_minutes: 32, habit_rate: 0.857, todos_done: 5, avg_sleep_minutes: 437, weight_change_kg: -0.4, water_goal_days: 3 }
  const health = params.get('health') !== '0'
  if (!health) Object.assign(week, { avg_sleep_minutes: null, weight_change_kg: null, water_goal_days: null })
  qc.setQueryData(dashboardKeys.week(weekStartOf(today)), week)
  qc.setQueryData(dashboardKeys.week(weekStartOf(today, -1)), { ...week, workouts: 2 })
  qc.setQueryData(dashboardKeys.parts(today), { chest: addDays(today, -1), back: addDays(today, -6), upper_legs: addDays(today, -3) })

  const habit = (id: string, name: string, emoji: string) => ({
    id, user_id: 'preview', name, emoji, rule: { type: 'daily' }, target_count: 1, unit: null, remind_at: null,
    sort_order: 0, starts_on: addDays(today, -30), archived_at: null, created_at: now, updated_at: now,
  })
  qc.setQueryData(todayKeys.habits, empty ? [] : [habit('h1', 'Esneme', '🧘'), habit('h2', 'Kitap', '📖'), habit('h3', 'Vitamin', '💊'), habit('h4', 'Yürüyüş', '🚶')])
  qc.setQueryData(todayKeys.logs(addDays(today, -HISTORY_DAYS), today), empty ? [] : [
    { id: 'l1', user_id: 'preview', habit_id: 'h1', day: today, count: 1, created_at: now, updated_at: now },
    { id: 'l2', user_id: 'preview', habit_id: 'h3', day: today, count: 1, created_at: now, updated_at: now },
  ])
  const todo = (id: string, title: string) => ({
    id, user_id: 'preview', title, note: null, priority: 0, due_on: today, rule: null, remind_at: null,
    starts_on: today, archived_at: null, created_at: now, updated_at: now,
  })
  qc.setQueryData(todayKeys.todos, {
    todos: empty ? [] : [todo('t1', 'Spor çantası'), todo('t2', 'Protein al'), todo('t3', 'Randevu')],
    completions: empty ? [] : [{ id: 'c1', user_id: 'preview', todo_id: 't1', day: today, completed_on: today, created_at: now }],
  })

  qc.setQueryData(sleepWaterKeys.water(today), empty ? [] : [
    { id: 'w1', user_id: 'preview', drunk_on: today, amount_ml: 500, logged_at: now, created_at: now },
    { id: 'w2', user_id: 'preview', drunk_on: today, amount_ml: 250, logged_at: now, created_at: now },
  ])
  qc.setQueryData(sleepWaterKeys.sleepWeek(today), empty ? [] : [
    { id: 's1', user_id: 'preview', sleep_on: today, bed_at: now, wake_at: now, duration_min: 452, quality: 4, note: null, created_at: now, updated_at: now },
  ])
  qc.setQueryData<BodyMetric[]>(bodyKeys.metrics, empty ? [] : [{ id: 'b1', user_id: 'preview', measured_on: addDays(today, -9), weight_kg: 78.4 } as BodyMetric])
  qc.setQueryData(settingsKeys.me(userId), {
    user_id: userId, locale: 'tr', theme: 'system', daily_water_ml: 2500,
    unit_weight: params.get('units') === 'imperial' ? 'lb' : 'kg', unit_length: params.get('units') === 'imperial' ? 'in' : 'cm',
  } as UserSettings)

  // no plan today: the workout card shows its free-session state
  qc.setQueryData(workoutKeys.templates, [])
  qc.setQueryData(workoutKeys.today(isoWeekday(), today), [])
  qc.setQueryData(workoutKeys.active, null)
  return qc
}

/** Layout route: sample cache + every preview flag + the normal app frame (tab bar). */
export function DevHomeLayout() {
  const [params] = useSearchParams()
  const { user } = useAuth()
  const [client] = useState(() => seed(params, user?.id ?? ''))
  return (
    <QueryClientProvider client={client}>
      <DashboardPreviewContext.Provider value={true}>
        <WorkoutsPreviewContext.Provider value={true}>
          <SleepWaterPreviewContext.Provider value={true}>
            <BodyPreviewContext.Provider value={true}>
              <NutritionPreviewContext.Provider value={true}>
                <BadgesPreviewContext.Provider value={true}>
                  <AppShell />
                </BadgesPreviewContext.Provider>
              </NutritionPreviewContext.Provider>
            </BodyPreviewContext.Provider>
          </SleepWaterPreviewContext.Provider>
        </WorkoutsPreviewContext.Provider>
      </DashboardPreviewContext.Provider>
    </QueryClientProvider>
  )
}

export function DevHome() {
  const [params] = useSearchParams()
  const hour = Number(params.get('hour') ?? 21)
  const at = new Date()
  at.setHours(Number.isFinite(hour) ? hour : 21, 5, 0, 0)
  const celebrate = params.get('celebrate')
  const codes = BADGES.map((b) => b.code).filter((c) => celebrate?.split(',').includes(c)) as BadgeCode[]
  return (
    <DashboardPage
      preview={{
        points: 1240,
        streak: 9,
        energy: { burned: { kcal: 412, sessions: 1 }, eaten: { kcal: 1640, entries: 6 } },
        health: params.get('health') !== '0',
        suggest: { now: at, streak: 9, lastActiveOn: addDays(toLocalDateISO(), -1) },
        celebrate: codes,
        base: '/__dev',
      }}
    />
  )
}
