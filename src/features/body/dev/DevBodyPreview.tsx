import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from '@/app/AppShell'
import { NutritionPreviewContext, nutritionKeys } from '@/features/nutrition'
import { workoutKeys } from '@/features/workouts'
import { NutritionPage } from '@/features/nutrition/pages/NutritionPage'
import type { Food, MealEntry } from '@/features/nutrition/types'
import { TrackPage } from '@/features/track/pages/TrackPage'
import { toLocalDateISO } from '@/lib/dates'
import { bodyKeys } from '../hooks'
import { BodyPage } from '../pages/BodyPage'
import { BodyPreviewContext } from '../previewContext'
import type { BodyMetric } from '../types'

/** ~3 months of noisy weigh-ins drifting from 86 to 82 kg, with a few weekly measurements. ?empty=1 for a fresh user. */
function sampleRows(): BodyMetric[] {
  const rows: BodyMetric[] = []
  const today = new Date()
  for (let i = 92; i >= 1; i--) {
    if (i % 3 === 1 && i > 10) continue
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const trend = 82 + (4 * i) / 92
    const noise = Math.sin(i * 1.7) * 0.6 + Math.cos(i * 0.9) * 0.3
    const weekly = i % 7 === 2
    const day = toLocalDateISO(d)
    rows.push({
      id: `s-${day}`,
      user_id: 'preview',
      measured_on: day,
      weight_kg: Math.round((trend + noise) * 10) / 10,
      neck_cm: weekly ? 39 : null,
      waist_cm: weekly ? Math.round((88 + i / 15) * 2) / 2 : null,
      chest_cm: weekly && i % 14 === 2 ? 102 : null,
      arm_cm: weekly ? 35.5 : null,
      hip_cm: null,
      thigh_cm: weekly && i < 40 ? 58 : null,
      note: null,
      created_at: d.toISOString(),
      updated_at: d.toISOString(),
    })
  }
  return rows.reverse()
}

function seed(empty: boolean, aiClosed: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  qc.setQueryData(bodyKeys.metrics, empty ? [] : sampleRows())
  qc.setQueryData(bodyKeys.target, { target: empty ? null : 78, start: empty ? 84 : 86, height: empty ? null : 180, sex: 'male' })
  qc.setQueryData(nutritionKeys.day(toLocalDateISO()), empty ? [] : sampleMeals())
  qc.setQueryData(nutritionKeys.foods, empty ? [] : sampleFoods())
  // ?ai=closed shows the "free quota used up" card in the add-food sheet
  const pacificMidnight = new Date(Date.now() + 9 * 3600_000)
  qc.setQueryData(['nutrition', 'ai-availability'], aiClosed ? { available: false, reason: 'google_daily', resets_at: pacificMidnight.toISOString(), user_left: 38 } : { available: true, reason: 'ok', resets_at: null, user_left: 38 })
  const now = new Date()
  const session = {
    id: 'preview-session',
    kind: 'strength',
    title: null,
    templateName: 'İtiş: göğüs, omuz',
    started_at: new Date(now.getTime() - 3 * 3600_000).toISOString(),
    ended_at: new Date(now.getTime() - 2 * 3600_000).toISOString(),
    duration_sec: 3120,
    total_sets: 16,
    total_volume_kg: 7845,
    kcal_estimate: 412,
    template_id: null,
    cardio: [],
  }
  qc.setQueryData(workoutKeys.day(toLocalDateISO()), empty ? [] : [session])
  return qc
}

export function DevBodyLayout() {
  const [params] = useSearchParams()
  const [client] = useState(() => seed(params.get('empty') === '1', params.get('ai') === 'closed'))
  return (
    <QueryClientProvider client={client}>
      <BodyPreviewContext.Provider value={true}>
        <NutritionPreviewContext.Provider value={true}>
          <AppShell />
        </NutritionPreviewContext.Provider>
      </BodyPreviewContext.Provider>
    </QueryClientProvider>
  )
}

export function DevTrack() {
  return <TrackPage preview />
}

export function DevBody() {
  return <BodyPage />
}

export function DevNutrition() {
  return <NutritionPage preview={{ goals: { kcal: 2200, protein: 140 }, burned: { kcal: 412, sessions: 1 } }} />
}

function sampleMeals(): MealEntry[] {
  const day = toLocalDateISO()
  const at = (h: number, m = 0) => new Date(new Date().setHours(h, m, 0, 0)).toISOString()
  const row = (id: string, slot: string, name: string, kcal: number, p: number, c: number, f: number, h: number): MealEntry => ({
    id,
    user_id: 'preview',
    eaten_on: day,
    meal_slot: slot,
    food_id: null,
    name,
    servings: 1,
    kcal,
    protein_g: p,
    carb_g: c,
    fat_g: f,
    source: 'ai_text',
    created_at: at(h),
    updated_at: at(h),
  })
  return [
    row('m1', 'breakfast', 'Haşlanmış yumurta · 2 adet', 155, 12.6, 1.1, 10.6, 8),
    row('m2', 'breakfast', 'Beyaz peynir · 1 dilim (30 g)', 93, 5.1, 0.6, 7.8, 8),
    row('m3', 'breakfast', 'Tam buğday ekmeği · 2 dilim', 160, 7.2, 28.4, 2.2, 8),
    row('m4', 'lunch', 'Tavuk göğsü ızgara · 200 g', 330, 62, 0, 7.2, 13),
    row('m5', 'lunch', 'Bulgur pilavı · 1 kase', 260, 7, 50, 4.5, 13),
    row('m6', 'snack', 'Yoğurt · 1 kase (200 g)', 122, 7, 9.4, 6.4, 16),
  ]
}

function sampleFoods(): Food[] {
  const f = (id: string, name: string, serving: string, kcal: number, p: number, c: number, fat: number): Food => ({
    id,
    user_id: 'preview',
    name,
    serving_desc: serving,
    kcal,
    protein_g: p,
    carb_g: c,
    fat_g: fat,
    use_count: 3,
    last_used_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  return [f('f1', 'Yulaf ezmesi', '40 g', 150, 5.3, 27, 2.7), f('f2', 'Muz', '1 orta boy', 105, 1.3, 27, 0.4), f('f3', 'Whey protein', '1 ölçek', 120, 24, 3, 1.5)]
}
