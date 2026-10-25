import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  getExercise,
  getExerciseProgress,
  getExercisesByIds,
  getFacets,
  getMuscleCatalog,
  getRecentSets,
  PAGE_SIZE,
  searchExercises,
  signMedia,
} from './api'
import type { ExerciseFilters } from './types'

export const exerciseKeys = {
  all: ['exercises'] as const,
  search: (f: ExerciseFilters) => ['exercises', 'search', f] as const,
  one: (id: string) => ['exercises', 'one', id] as const,
  many: (ids: string[]) => ['exercises', 'many', [...ids].sort()] as const,
  facets: ['exercises', 'facets'] as const,
  muscles: ['exercises', 'muscle-catalog'] as const,
  /** Invalidate `['exercises', 'progress']` after a session is finished or edited. */
  progress: (id: string) => ['exercises', 'progress', id] as const,
  recentSets: (id: string, limit: number) => ['exercises', 'progress', id, 'sets', limit] as const,
  media: (path: string) => ['exercise-media', path] as const,
  mediaBatch: (paths: string[]) => ['exercise-media', 'batch', [...paths].sort()] as const,
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

/** Signed URLs for several storage paths in one request (muscle diagram: silhouettes + overlays). */
export function useMediaUrls(paths: string[]) {
  return useQuery({
    queryKey: exerciseKeys.mediaBatch(paths),
    queryFn: () => signMedia(paths),
    enabled: paths.length > 0,
    staleTime: 50 * 60_000,
    gcTime: 55 * 60_000,
  })
}

/** wger muscles + alias table; changes only when the sync script runs. */
export function useMuscleCatalog() {
  return useQuery({ queryKey: exerciseKeys.muscles, queryFn: getMuscleCatalog, staleTime: 24 * 60 * 60_000 })
}

export function useExerciseProgress(id: string | undefined) {
  return useQuery({
    queryKey: exerciseKeys.progress(id ?? ''),
    queryFn: () => getExerciseProgress(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  })
}

export function useRecentSets(id: string | undefined, limit = 10) {
  return useQuery({
    queryKey: exerciseKeys.recentSets(id ?? '', limit),
    queryFn: () => getRecentSets(id!, limit),
    enabled: Boolean(id),
    staleTime: 60_000,
  })
}
