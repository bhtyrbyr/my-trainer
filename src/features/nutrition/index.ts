// Public surface of the nutrition feature. Other features import ONLY from here.
import { useQuery } from '@tanstack/react-query'
import { toLocalDateISO } from '@/lib/dates'
import { listMealDays, listMeals } from './api'
import { nutritionKeys } from './hooks'
import { totalsOf } from './logic'
import { useIsNutritionPreview } from './previewContext'

export { nutritionKeys } from './hooks'
export { NutritionPreviewContext } from './previewContext'

/** Calories eaten on a local day (default today); shares the day's meals query. `previewValue` skips the network. */
export function useEatenOn(day: string = toLocalDateISO(), previewValue?: { kcal: number; entries: number }) {
  const preview = useIsNutritionPreview()
  const q = useQuery({ queryKey: nutritionKeys.day(day), queryFn: () => listMeals(day), enabled: !preview && !previewValue })
  if (previewValue) return { ...q, isLoading: false, isError: false, data: previewValue }
  return { ...q, data: q.data ? { kcal: totalsOf(q.data).kcal, entries: q.data.length } : undefined }
}

export { useMeals, useAiAvailability } from './hooks'
export type { AiAvailability } from './api'
export { MEAL_SLOTS } from './types'
export type { MealEntry, MealSlot } from './types'

/** Days with meals in [from, to] (inclusive, YYYY-MM-DD). */
export function useMealDays(from: string, to: string) {
  const preview = useIsNutritionPreview()
  return useQuery({ queryKey: [...nutritionKeys.all, 'days', from, to], queryFn: () => listMealDays(from, to), enabled: !preview, staleTime: 5 * 60_000 })
}
