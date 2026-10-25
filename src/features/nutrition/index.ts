// Public surface of the nutrition feature. Other features import ONLY from here.
import { useQuery } from '@tanstack/react-query'
import { toLocalDateISO } from '@/lib/dates'
import { listMeals } from './api'
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
