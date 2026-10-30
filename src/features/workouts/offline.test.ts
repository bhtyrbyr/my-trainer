import { describe, expect, it, vi } from 'vitest'
import type { QueuedOp } from '@/lib/offline/queue'
import { createFakeSupabase } from '@/test/fakeSupabase'

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeSupabase> | null }))
vi.mock('@/lib/supabase', async () => {
  const { createFakeSupabase } = await import('@/test/fakeSupabase')
  fake.current = createFakeSupabase()
  return { supabase: fake.current.client }
})

import * as api from './api'
import { applyActiveOps, applySessionOps, queuedRowState, type WorkoutVars } from './offline'
import type { SessionBundle, WorkoutSession } from './schema'

const at = '2026-10-31T10:00:00.000Z'
const session = { id: 's1', started_at: '2026-10-31T09:00:00.000Z', ended_at: null, kind: 'strength' } as unknown as WorkoutSession
const bundle: SessionBundle = {
  session,
  templateName: null,
  cardio: [],
  exercises: [
    {
      id: 'e1',
      session_id: 's1',
      user_id: 'u1',
      exercise_id: 'x1',
      position: 0,
      notes: null,
      created_at: at,
      updated_at: at,
      target: null,
      sets: [{ id: 'set1', session_id: 's1', session_exercise_id: 'e1', user_id: 'u1', set_no: 1, weight_kg: 50, reps: 10, rpe: null, is_warmup: false, completed_at: at, created_at: at, updated_at: at }],
    },
  ],
}
const op = (o: string, vars: object, status: 'pending' | 'error' = 'pending'): QueuedOp<WorkoutVars> => ({ mutationId: 0, op: o, vars: { userId: 'u1', at, ...vars } as WorkoutVars, status })
const addSet = (id: string, setNo: number, exId = 'e1') =>
  op('addSet', { id, sessionId: 's1', sessionExerciseId: exId, setNo, weightKg: 60, reps: 8, rpe: null, isWarmup: false })

describe('applySessionOps', () => {
  it('shows queued exercises and sets in order, and queued removals', () => {
    const ops = [
      addSet('set2', 2),
      op('addExercise', { id: 'e2', sessionId: 's1', exerciseId: 'x2', position: 1 }),
      addSet('set3', 1, 'e2'),
      op('deleteSet', { sessionId: 's1', setId: 'set1' }),
    ]
    const out = applySessionOps(bundle, ops)!
    expect(out.exercises.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(out.exercises[0].sets.map((s) => s.id)).toEqual(['set2'])
    expect(out.exercises[1].sets.map((s) => [s.id, s.weight_kg, s.reps])).toEqual([['set3', 60, 8]])
  })

  it('is a no-op for writes already in the cache (same id) and for other sessions', () => {
    const synced = applySessionOps(bundle, [addSet('set1', 1)])!
    expect(synced.exercises[0].sets).toHaveLength(1)
    expect(applySessionOps(bundle, [op('addSet', { id: 'z', sessionId: 'other', sessionExerciseId: 'e1', setNo: 1 })])).toBe(bundle)
    expect(applySessionOps(null, [addSet('set2', 2)])).toBeNull()
  })

  it('a queued finish closes the session and hides it from "active"', () => {
    const fin = op('finish', { sessionId: 's1', emptyExerciseIds: [] })
    expect(applySessionOps(bundle, [fin])!.session.ended_at).toBe(at)
    expect(applyActiveOps(session, [fin])).toBeNull()
    expect(applyActiveOps(session, [])).toBe(session)
  })

  it('marks rows that are not on the server yet', () => {
    const m = queuedRowState([addSet('set2', 2), op('addSet', { id: 'set9', sessionId: 's1', sessionExerciseId: 'e1', setNo: 3 }, 'error')])
    expect(m.get('set2')).toBe('pending')
    expect(m.get('set9')).toBe('error')
    expect(m.has('set1')).toBe(false)
  })
})

describe('idempotent workout writes', () => {
  const newSet = { id: 'c-1', sessionId: 's1', sessionExerciseId: 'e1', setNo: 1, weightKg: 80, reps: 5, rpe: null, isWarmup: false }

  it('a replayed set insert returns the stored row instead of logging it twice', async () => {
    const first = await api.addSet('u1', newSet)
    const replay = await api.addSet('u1', newSet)
    expect(replay).toEqual(first)
    expect(fake.current!.table('session_sets')).toHaveLength(1)
  })

  it('a replayed exercise insert is harmless too', async () => {
    const e = { id: 'c-e', sessionId: 's1', exerciseId: 'x9', position: 3 }
    await api.addSessionExercise('u1', e)
    const again = await api.addSessionExercise('u1', e)
    expect(again).toMatchObject({ id: 'c-e', sets: [], target: null })
    expect(fake.current!.table('session_exercises')).toHaveLength(1)
  })

  it('a replayed finish (ALREADY_FINISHED) reads the closed session back with its points', async () => {
    const f = fake.current!
    f.table('workout_sessions').push({ id: 's1', duration_sec: 3600, total_sets: 12, total_volume_kg: '4800.0', kcal_estimate: 310, kcal_weight_kg: null })
    f.table('point_events').push({ ref_table: 'workout_sessions', ref_id: 's1', points: 74 })
    f.rpcs.set('finish_workout_session', () => ({ data: null, error: { code: 'P0001', message: 'ALREADY_FINISHED' } }))
    const summary = await api.finishSession('s1', [])
    expect(summary).toMatchObject({ duration_sec: 3600, total_sets: 12, total_volume_kg: 4800, points_awarded: 74, new_prs: [] })
  })
})
