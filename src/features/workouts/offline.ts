// Queued workout writes (offline queue, src/lib/offline): keys, variables and the pure overlay that shows
// them on top of the cached session before the server has them.
import { queuedKey, type QueuedOp, type QueuedVars } from '@/lib/offline/queue'
import type { NewSet, NewSessionExercise } from './api'
import type { BundleExercise, SessionBundle, SessionSet, WorkoutSession } from './schema'

export const workoutQueue = {
  addSet: queuedKey('workouts', 'addSet'),
  deleteSet: queuedKey('workouts', 'deleteSet'),
  addExercise: queuedKey('workouts', 'addExercise'),
  finish: queuedKey('workouts', 'finish'),
}

export type AddSetVars = QueuedVars & NewSet & { id: string }
export type DeleteSetVars = QueuedVars & { sessionId: string; setId: string }
export type AddExerciseVars = QueuedVars & NewSessionExercise
export type FinishVars = QueuedVars & { sessionId: string; emptyExerciseIds: string[] }
export type WorkoutVars = AddSetVars | DeleteSetVars | AddExerciseVars | FinishVars

/** The row a queued set will become (same id). */
export function pendingSetRow(v: AddSetVars): SessionSet {
  return {
    id: v.id,
    session_id: v.sessionId,
    session_exercise_id: v.sessionExerciseId,
    user_id: v.userId,
    set_no: v.setNo,
    weight_kg: v.weightKg,
    reps: v.reps,
    rpe: v.rpe,
    is_warmup: v.isWarmup,
    completed_at: v.at,
    created_at: v.at,
    updated_at: v.at,
  }
}

export function pendingExerciseRow(v: AddExerciseVars): BundleExercise {
  return {
    id: v.id,
    session_id: v.sessionId,
    user_id: v.userId,
    exercise_id: v.exerciseId,
    position: v.position,
    notes: null,
    created_at: v.at,
    updated_at: v.at,
    sets: [],
    target: null,
  }
}

/** Insert (or replace, by id) a set into its exercise, keeping set order. */
export function withSet(list: BundleExercise[], row: SessionSet): BundleExercise[] {
  return list.map((ex) =>
    ex.id === row.session_exercise_id ? { ...ex, sets: [...ex.sets.filter((s) => s.id !== row.id), row].sort((a, b) => a.set_no - b.set_no) } : ex,
  )
}

export function withoutSet(list: BundleExercise[], setId: string): BundleExercise[] {
  return list.map((ex) => (ex.sets.some((s) => s.id === setId) ? { ...ex, sets: ex.sets.filter((s) => s.id !== setId) } : ex))
}

export function withExercise(list: BundleExercise[], row: BundleExercise): BundleExercise[] {
  return list.some((e) => e.id === row.id) ? list : [...list, row]
}

/**
 * The session as the user sees it: the cached bundle with the queued writes of that session applied in
 * submission order. Writes already confirmed by the server are in the cache (same ids), so applying them
 * again is a no-op. Returns the input unchanged when nothing is queued for it.
 */
export function applySessionOps<B extends SessionBundle | null | undefined>(bundle: B, ops: readonly QueuedOp<WorkoutVars>[]): B {
  if (!bundle) return bundle
  const id = bundle.session.id
  const mine = ops.filter((o) => (o.vars as { sessionId?: string }).sessionId === id)
  if (!mine.length) return bundle
  let exercises = bundle.exercises
  let session = bundle.session
  for (const { op, vars } of mine) {
    if (op === 'addExercise') exercises = withExercise(exercises, pendingExerciseRow(vars as AddExerciseVars))
    else if (op === 'addSet') exercises = withSet(exercises, pendingSetRow(vars as AddSetVars))
    else if (op === 'deleteSet') exercises = withoutSet(exercises, (vars as DeleteSetVars).setId)
    else if (op === 'finish' && !session.ended_at) session = { ...session, ended_at: vars.at }
  }
  return { ...bundle, session, exercises }
}

/** The running session disappears once its finish is queued. */
export function applyActiveOps(active: WorkoutSession | null | undefined, ops: readonly QueuedOp<WorkoutVars>[]): WorkoutSession | null | undefined {
  if (!active) return active
  return ops.some((o) => o.op === 'finish' && (o.vars as FinishVars).sessionId === active.id) ? null : active
}

/** Sync state of each queued row id (sets and exercises) for small "not synced yet" marks. */
export function queuedRowState(ops: readonly QueuedOp<WorkoutVars>[]): Map<string, 'pending' | 'error'> {
  const out = new Map<string, 'pending' | 'error'>()
  for (const o of ops) if (o.op === 'addSet' || o.op === 'addExercise') out.set((o.vars as AddSetVars).id, o.status)
  return out
}
