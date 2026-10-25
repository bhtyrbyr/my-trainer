import { supabase } from '@/lib/supabase'
import { EXERCISE_COLUMNS, type Exercise, type ExerciseFilters } from './types'
import { sanitizeSearch } from './name'

export const MEDIA_BUCKET = 'exercise-media'
export const PAGE_SIZE = 30

/** One page of the catalog (+ the caller's custom exercises; RLS scopes custom rows to the owner). */
export async function searchExercises(filters: ExerciseFilters, page: number): Promise<Exercise[]> {
  let query = supabase.from('exercises').select(EXERCISE_COLUMNS).order('name_en', { ascending: true })
  const q = sanitizeSearch(filters.q)
  if (q) query = query.or(`name_en.ilike.%${q}%,name_tr.ilike.%${q}%`)
  if (filters.bodyPart) query = query.contains('body_parts', [filters.bodyPart])
  if (filters.muscle) query = query.contains('target_muscles', [filters.muscle])
  if (filters.equipment) query = query.contains('equipment', [filters.equipment])
  const from = page * PAGE_SIZE
  const { data, error } = await query.range(from, from + PAGE_SIZE - 1)
  if (error) throw error
  return (data ?? []) as Exercise[]
}

export async function getExercise(id: string): Promise<Exercise | null> {
  const { data, error } = await supabase.from('exercises').select(EXERCISE_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw error
  return (data as Exercise | null) ?? null
}

export async function getExercisesByIds(ids: string[]): Promise<Exercise[]> {
  if (!ids.length) return []
  const { data, error } = await supabase.from('exercises').select(EXERCISE_COLUMNS).in('id', ids)
  if (error) throw error
  return (data ?? []) as Exercise[]
}

export type Facets = { bodyParts: string[]; muscles: string[]; equipment: string[] }

/** Distinct filter values present in the catalog (~1500 small rows, cached for a day by the hook). */
export async function getFacets(): Promise<Facets> {
  const { data, error } = await supabase.from('exercises').select('body_parts, target_muscles, equipment').limit(5000)
  if (error) throw error
  const bp = new Set<string>(), mu = new Set<string>(), eq = new Set<string>()
  for (const r of data ?? []) {
    r.body_parts?.forEach((v) => bp.add(v))
    r.target_muscles?.forEach((v) => mu.add(v))
    r.equipment?.forEach((v) => eq.add(v))
  }
  const sort = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b))
  return { bodyParts: sort(bp), muscles: sort(mu), equipment: sort(eq) }
}

/** Signed URLs for private media (GIFs, muscle SVGs). Valid for one hour; hooks cache them for 50 min. */
export async function signMedia(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))]
  if (!unique.length) return {}
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(unique, 3600)
  if (error) throw error
  const out: Record<string, string> = {}
  for (const item of data ?? []) if (item.path && item.signedUrl) out[item.path] = item.signedUrl
  return out
}
