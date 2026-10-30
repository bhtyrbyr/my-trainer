// Raw Supabase calls for the workouts feature. Reads rely on RLS (no client-side user_id filter);
// inserts pass the signed-in user's id, which the RLS `with check` and the ownership triggers verify.
import { supabase } from '@/lib/supabase'
import { isDuplicate } from '@/lib/offline/queue'
import type { TablesInsert } from '@/lib/database.types'
import { matchTargets } from './logic'
import {
  finishSummary,
  type BundleExercise,
  type CardioInput,
  type FinishSummary,
  type HistoryItem,
  type SessionBundle,
  type SessionSet,
  type TargetInfo,
  type TemplateInput,
  type TemplateWithExercises,
  type WorkoutSession,
  type WorkoutTemplate,
} from './schema'
import { cardioValues } from './logic'

const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position

// -----------------------------------------------------------------------------
// Templates (plans)
// -----------------------------------------------------------------------------
export async function listTemplates(): Promise<TemplateWithExercises[]> {
  const { data, error } = await supabase
    .from('workout_templates')
    .select('*, template_exercises(*)')
    .eq('archived', false)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((t) => ({ ...t, template_exercises: [...(t.template_exercises ?? [])].sort(byPosition) }))
}

export async function getTemplate(id: string): Promise<TemplateWithExercises | null> {
  const { data, error } = await supabase.from('workout_templates').select('*, template_exercises(*)').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return null
  return { ...data, template_exercises: [...(data.template_exercises ?? [])].sort(byPosition) }
}

/** Plans for an ISO weekday (default: today, server clock). */
export async function todaysTemplates(isodow?: number): Promise<WorkoutTemplate[]> {
  const { data, error } = await supabase.rpc('todays_templates', isodow ? { p_isodow: isodow } : {})
  if (error) throw error
  return (data ?? []) as WorkoutTemplate[]
}

/**
 * Create or update a plan with its ordered exercise list. Exercise rows carry client-generated ids, so
 * one upsert both inserts new rows and rewrites kept ones; removed rows are deleted only after the upsert
 * succeeded (a failed save never empties a plan).
 */
export async function saveTemplate(userId: string, id: string | null, input: TemplateInput): Promise<string> {
  let templateId = id
  if (templateId) {
    const { error } = await supabase
      .from('workout_templates')
      .update({ name: input.name.trim(), weekdays: input.weekdays })
      .eq('id', templateId)
    if (error) throw error
  } else {
    const { data, error } = await supabase
      .from('workout_templates')
      .insert({ user_id: userId, name: input.name.trim(), weekdays: input.weekdays })
      .select('id')
      .single()
    if (error) throw error
    templateId = data.id
  }

  const rows: TablesInsert<'template_exercises'>[] = input.exercises.map((ex, position) => ({
    id: ex.id,
    template_id: templateId!,
    user_id: userId,
    exercise_id: ex.exercise_id,
    position,
    target_sets: ex.target_sets,
    target_reps_low: ex.target_reps_low,
    target_reps_high: ex.target_reps_high,
    rest_seconds: ex.rest_seconds,
  }))
  if (rows.length) {
    const { error } = await supabase.from('template_exercises').upsert(rows, { onConflict: 'id' })
    if (error) throw error
  }
  let del = supabase.from('template_exercises').delete().eq('template_id', templateId!)
  if (rows.length) del = del.not('id', 'in', `(${rows.map((r) => r.id).join(',')})`)
  const { error: delError } = await del
  if (delError) throw delError
  return templateId!
}

/** Archive instead of delete: past sessions keep their link and the plan can be restored later. */
export async function archiveTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('workout_templates').update({ archived: true }).eq('id', id)
  if (error) throw error
}

// -----------------------------------------------------------------------------
// Sessions
// -----------------------------------------------------------------------------
export async function getActiveSession(): Promise<WorkoutSession | null> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('*')
    .eq('kind', 'strength')
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

/** Start a strength session; with a plan, its exercises are copied in plan order (positions kept). */
export async function startSession(userId: string, template: TemplateWithExercises | null): Promise<string> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .insert({ user_id: userId, kind: 'strength', template_id: template?.id ?? null, title: template?.name ?? null })
    .select('id')
    .single()
  if (error) throw error
  const sessionId = data.id
  const items = template?.template_exercises ?? []
  if (items.length) {
    const { error: exError } = await supabase.from('session_exercises').insert(
      items.map((te) => ({ session_id: sessionId, user_id: userId, exercise_id: te.exercise_id, position: te.position })),
    )
    if (exError) {
      await supabase.from('workout_sessions').delete().eq('id', sessionId)
      throw exError
    }
  }
  return sessionId
}

export async function getSessionBundle(id: string): Promise<SessionBundle | null> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('*, workout_templates(name), session_exercises(*, session_sets(*)), cardio_entries(*)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const { workout_templates: tpl, session_exercises: ses, cardio_entries: cardio, ...session } = data
  let targets: TargetInfo[] = []
  if (session.template_id) {
    const { data: te, error: teError } = await supabase
      .from('template_exercises')
      .select('exercise_id, position, target_sets, target_reps_low, target_reps_high, rest_seconds')
      .eq('template_id', session.template_id)
    if (teError) throw teError
    targets = te ?? []
  }
  const ordered = [...(ses ?? [])].sort(byPosition)
  const matched = matchTargets(ordered, targets)
  const exercises: BundleExercise[] = ordered.map(({ session_sets, ...se }) => ({
    ...se,
    sets: [...(session_sets ?? [])].sort((a, b) => a.set_no - b.set_no),
    target: matched.get(se.id) ?? null,
  }))
  return { session, templateName: tpl?.name ?? null, exercises, cardio: cardio ?? [] }
}

export type NewSet = {
  sessionId: string
  sessionExerciseId: string
  setNo: number
  weightKg: number | null
  reps: number | null
  rpe: number | null
  isWarmup: boolean
}

/**
 * Log a set. `id` is generated on the device (offline queue): a replay of an insert that already reached
 * the server hits the primary key and returns the stored row instead of logging the set twice.
 */
export async function addSet(userId: string, s: NewSet & { id: string }): Promise<SessionSet> {
  const { data, error } = await supabase
    .from('session_sets')
    .insert({
      id: s.id,
      // session_id is re-derived server-side from the parent session_exercise; sent only to satisfy the type
      session_id: s.sessionId,
      session_exercise_id: s.sessionExerciseId,
      user_id: userId,
      set_no: s.setNo,
      weight_kg: s.weightKg,
      reps: s.reps,
      rpe: s.rpe,
      is_warmup: s.isWarmup,
    })
    .select('*')
    .single()
  if (error) {
    if (!isDuplicate(error)) throw error
    const { data: existing, error: readError } = await supabase.from('session_sets').select('*').eq('id', s.id).single()
    if (readError) throw readError
    return existing
  }
  return data
}

export async function deleteSet(id: string): Promise<void> {
  const { error } = await supabase.from('session_sets').delete().eq('id', id)
  if (error) throw error
}

export type NewSessionExercise = { id: string; sessionId: string; exerciseId: string; position: number }

/** Add an exercise to a running session; client id as for sets (idempotent replay). */
export async function addSessionExercise(userId: string, e: NewSessionExercise): Promise<BundleExercise> {
  const { data, error } = await supabase
    .from('session_exercises')
    .insert({ id: e.id, session_id: e.sessionId, user_id: userId, exercise_id: e.exerciseId, position: e.position })
    .select('*')
    .single()
  if (error) {
    if (!isDuplicate(error)) throw error
    const { data: existing, error: readError } = await supabase.from('session_exercises').select('*').eq('id', e.id).single()
    if (readError) throw readError
    return { ...existing, sets: [], target: null }
  }
  return { ...data, sets: [], target: null }
}

/**
 * Close the session (server computes totals, points and PRs). Planned-but-skipped exercises are removed
 * first: an empty session_exercise would otherwise hide older data from last_sets_for_exercise().
 */
export async function finishSession(id: string, emptyExerciseIds: string[]): Promise<FinishSummary> {
  if (emptyExerciseIds.length) {
    const { error } = await supabase.from('session_exercises').delete().in('id', emptyExerciseIds)
    if (error) throw error
  }
  const { data, error } = await supabase.rpc('finish_workout_session', { p_session: id })
  if (error) {
    // A replayed finish whose first attempt went through (answer lost on a dead connection): read it back.
    if (/ALREADY_FINISHED/.test(error.message)) return finishedSummary(id)
    throw error
  }
  // The energy estimate is written by a trigger during finish; read it back (best effort).
  const { data: energy } = await supabase.from('workout_sessions').select('kcal_estimate, kcal_weight_kg').eq('id', id).maybeSingle()
  return finishSummary.parse({ ...(data as object | null), ...(energy ?? {}) })
}

/** Summary of a session that is already closed (no PR list: those were announced by the first finish). */
async function finishedSummary(id: string): Promise<FinishSummary> {
  const [{ data: s, error }, { data: points }] = await Promise.all([
    supabase.from('workout_sessions').select('duration_sec, total_sets, total_volume_kg, kcal_estimate, kcal_weight_kg').eq('id', id).single(),
    supabase.from('point_events').select('points').eq('ref_table', 'workout_sessions').eq('ref_id', id),
  ])
  if (error) throw error
  return finishSummary.parse({ ...s, points_awarded: (points ?? []).reduce((sum, p) => sum + p.points, 0) })
}

/** Estimated energy burned by finished sessions that started in [fromISO, toISO). Own rows only (RLS). */
export async function burnedBetween(fromISO: string, toISO: string): Promise<{ kcal: number; sessions: number }> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('kcal_estimate')
    .not('ended_at', 'is', null)
    .gte('started_at', fromISO)
    .lt('started_at', toISO)
  if (error) throw error
  const rows = data ?? []
  return { kcal: rows.reduce((sum, r) => sum + (r.kcal_estimate ?? 0), 0), sessions: rows.length }
}

/** Deleting a session cascades to its sets/PRs; the server revokes the related points. */
export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase.from('workout_sessions').delete().eq('id', id)
  if (error) throw error
}

export type LastSet = { set_no: number; weight_kg: number | null; reps: number | null; rpe: number | null; is_warmup: boolean; started_at: string }

/** Sets of the most recent finished session that contained this exercise. */
export async function lastSetsForExercise(exerciseId: string): Promise<LastSet[]> {
  const { data, error } = await supabase.rpc('last_sets_for_exercise', { p_exercise: exerciseId, p_limit: 1 })
  if (error) throw error
  return (data ?? []).map((r) => ({
    set_no: r.set_no,
    weight_kg: r.weight_kg == null ? null : Number(r.weight_kg),
    reps: r.reps,
    rpe: r.rpe == null ? null : Number(r.rpe),
    is_warmup: r.is_warmup,
    started_at: r.started_at,
  }))
}

// -----------------------------------------------------------------------------
// Cardio quick log: one session + one entry, closed right away (points via finish)
// -----------------------------------------------------------------------------
export async function logCardio(userId: string, input: CardioInput): Promise<FinishSummary> {
  const values = cardioValues(input)
  const startedAt = new Date(Date.now() - values.duration_sec * 1000).toISOString()
  const { data, error } = await supabase
    .from('workout_sessions')
    .insert({ user_id: userId, kind: 'cardio', started_at: startedAt })
    .select('id')
    .single()
  if (error) throw error
  const sessionId = data.id
  const { error: ceError } = await supabase
    .from('cardio_entries')
    .insert({ session_id: sessionId, user_id: userId, activity: input.activity, ...values })
  if (ceError) {
    await supabase.from('workout_sessions').delete().eq('id', sessionId)
    throw ceError
  }
  return finishSession(sessionId, [])
}

// -----------------------------------------------------------------------------
// History
// -----------------------------------------------------------------------------
export async function listSessionsBetween(fromISO: string, toISO: string): Promise<HistoryItem[]> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select(
      'id, kind, title, started_at, ended_at, duration_sec, total_sets, total_volume_kg, kcal_estimate, template_id, workout_templates(name), cardio_entries(activity, duration_sec, distance_m)',
    )
    .not('ended_at', 'is', null)
    .gte('started_at', fromISO)
    .lt('started_at', toISO)
    .order('started_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(({ workout_templates: tpl, cardio_entries, ...s }) => ({
    ...s,
    total_volume_kg: Number(s.total_volume_kg),
    templateName: tpl?.name ?? null,
    cardio: cardio_entries ?? [],
  }))
}
