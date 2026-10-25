import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { getExercise, getExercisesByIds, getFacets, PAGE_SIZE, searchExercises, signMedia } from './api'
import type { ExerciseFilters } from './types'

export const exerciseKeys = {
  all: ['exercises'] as const,
  search: (f: ExerciseFilters) => ['exercises', 'search', f] as const,
  one: (id: string) => ['exercises', 'one', id] as const,
  many: (ids: string[]) => ['exercises', 'many', [...ids].sort()] as const,
  facets: ['exercises', 'facets'] as const,
  media: (path: string) => ['exercise-media', path] as const,
}

export function useExerciseSearch(filters: ExerciseFilters) {
  return useInfiniteQuery({
    queryKey: exerciseKeys.search(filters),
    queryFn: ({ pageParam }) => searchExercises(filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length === PAGE_SIZE ? all.length : undefined),
    staleTime: 5 * 60_000,
  })
}

export function useExercise(id: string | undefined) {
  return useQuery({
    queryKey: exerciseKeys.one(id ?? ''),
    queryFn: () => getExercise(id!),
    enabled: Boolean(id),
    staleTime: 60 * 60_000,
  })
}

export function useExercisesByIds(ids: string[]) {
  return useQuery({
    queryKey: exerciseKeys.many(ids),
    queryFn: () => getExercisesByIds(ids),
    enabled: ids.length > 0,
    staleTime: 60 * 60_000,
  })
}

export function useExerciseFacets() {
  return useQuery({ queryKey: exerciseKeys.facets, queryFn: getFacets, staleTime: 24 * 60 * 60_000 })
}

/** Signed URL for one storage path in exercise-media (GIF or muscle SVG). */
export function useMediaUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: exerciseKeys.media(path ?? ''),
    queryFn: async () => (await signMedia([path!]))[path!] ?? null,
    enabled: Boolean(path),
    staleTime: 50 * 60_000,
    gcTime: 55 * 60_000,
  })
}
