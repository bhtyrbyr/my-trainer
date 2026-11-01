import { useQuery } from '@tanstack/react-query'
import type { BodyFigures, BodySex } from './types'

/** Figure data is ~60-70 KB per sex: one chunk per sex, fetched the first time a map is drawn. */
const loaders: Record<BodySex, () => Promise<BodyFigures>> = {
  male: () => import('./male').then((m) => m.MALE),
  female: () => import('./female').then((m) => m.FEMALE),
}

/** Front and back figures for one sex; code, not user data, so kept for the session and never persisted. */
export function useBodyFigures(sex: BodySex) {
  return useQuery({
    queryKey: ['exercises', 'bodymap', sex],
    queryFn: loaders[sex],
    staleTime: Infinity,
    gcTime: Infinity,
    meta: { persist: false },
  })
}
