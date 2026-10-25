import { supabase } from '@/lib/supabase'
import { EXERCISE_COLUMNS, type Exercise, type ExerciseFilters } from './types'
import { sanitizeSearch } from './name'
import type { MuscleCatalog } from './muscles'
import { toNum, type LoggedSet, type ProgressPoint } from './progress'

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

/** wger muscles + ExerciseDB alias table (15 + ~40 rows; cached for a day by the hook). */
export async function getMuscleCatalog(): Promise<MuscleCatalog> {
  const [muscles, aliases] = await Promise.all([
    supabase.from('muscles').select('wger_id, name_latin, name_en, name_tr, is_front, svg_main_path, svg_secondary_path'),
    supabase.from('muscle_aliases').select('exercisedb_name, wger_id'),
  ])
  if (muscles.error) throw muscles.error
  if (aliases.error) throw aliases.error
  const map: Record<string, number | null> = {}
  for (const a of aliases.data ?? []) map[a.exercisedb_name.toLocaleLowerCase('en')] = a.wger_id
  return { muscles: muscles.data ?? [], aliases: map }
}

/** Per finished session of the caller: best/avg weight, e1RM, volume (the RPC scopes to auth.uid()). */
export async function getExerciseProgress(exerciseId: string): Promise<ProgressPoint[]> {
  const { data, error } = await supabase.rpc('exercise_progress', { p_exercise: exerciseId })
  if (error) throw error
  return (data ?? []).map((r) => ({
    session_id: r.session_id,
    started_at: r.started_at,
    best_e1rm: toNum(r.best_e1rm),
    best_weight_kg: toNum(r.best_weight_kg),
    avg_weight_kg: toNum(r.avg_weight_kg),
    best_reps: toNum(r.best_reps),
    total_volume_kg: toNum(r.total_volume_kg),
    total_sets: toNum(r.total_sets) ?? 0,
  }))
}

/** Sets of the caller's last `limit` finished sessions containing this exercise, newest session first. */
export async function getRecentSets(exerciseId: string, limit: number): Promise<LoggedSet[]> {
  const { data, error } = await supabase.rpc('last_sets_for_exercise', { p_exercise: exerciseId, p_limit: limit })
  if (error) throw error
  return (data ?? []).map((r) => ({
    session_id: r.session_id,
    started_at: r.started_at,
    set_id: r.set_id,
    set_no: r.set_no,
    weight_kg: toNum(r.weight_kg),
    reps: toNum(r.reps),
    rpe: toNum(r.rpe),
    is_warmup: Boolean(r.is_warmup),
  }))
}
