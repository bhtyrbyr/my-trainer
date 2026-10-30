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
import { applyHabitOps, applyTodoOps, type TodayVars } from './offline'
import type { HabitLog, Todo, TodoCompletion } from './types'

const at = '2026-10-31T10:00:00.000Z'
const op = (o: string, vars: object, status: 'pending' | 'error' = 'pending'): QueuedOp<TodayVars> => ({ mutationId: 0, op: o, vars: { userId: 'u1', at, ...vars } as TodayVars, status })
const log = (habit: string, day: string, count: number): HabitLog => ({ id: `l-${habit}-${day}`, user_id: 'u1', habit_id: habit, day, count, created_at: at, updated_at: at })

describe('applyHabitOps', () => {
  const rows = [log('h1', '2026-10-31', 1), log('h2', '2026-10-30', 2)]

  it('applies queued absolute counts in order, last one wins; 0 removes the day', () => {
    const out = applyHabitOps(rows, '2026-07-01', '2026-10-31', [
      op('setHabitCount', { habitId: 'h1', day: '2026-10-31', count: 2 }),
      op('setHabitCount', { habitId: 'h1', day: '2026-10-31', count: 3 }),
      op('setHabitCount', { habitId: 'h2', day: '2026-10-30', count: 0 }),
      op('setHabitCount', { habitId: 'h3', day: '2026-10-31', count: 1 }),
    ])!
    expect(out.map((r) => [r.habit_id, r.count])).toEqual([
      ['h1', 3],
      ['h3', 1],
    ])
    expect(out[0].id).toBe('l-h1-2026-10-31') // keeps the server id when the log already exists
  })

  it('ignores days outside the window and to-do writes', () => {
    expect(applyHabitOps(rows, '2026-10-31', '2026-10-31', [op('setHabitCount', { habitId: 'h2', day: '2026-10-30', count: 0 })])).toBe(rows)
    expect(applyHabitOps(rows, '2026-07-01', '2026-10-31', [op('completeTodo', { id: 'c', todoId: 't', day: '2026-10-31' })])).toBe(rows)
  })
})

describe('applyTodoOps', () => {
  const data = { todos: [{ id: 't1' } as Todo], completions: [{ id: 'c0', todo_id: 't1', day: '2026-10-30' } as TodoCompletion] }

  it('shows queued ticks and un-ticks in order', () => {
    const out = applyTodoOps(data, [op('completeTodo', { id: 'c1', todoId: 't1', day: '2026-10-31' }), op('uncompleteTodo', { id: 'c0', todoId: 't1' })])!
    expect(out.completions.map((c) => [c.id, c.day])).toEqual([['c1', '2026-10-31']])
    expect(out.completions[0].completed_on).toBe('2026-10-31')
  })

  it('a tick already in the cache (same id) is not doubled', () => {
    expect(applyTodoOps(data, [op('completeTodo', { id: 'c0', todoId: 't1', day: '2026-10-30' })])!.completions).toHaveLength(1)
  })
})

describe('idempotent habit / to-do writes', () => {
  it('habit counts are absolute upserts: replays leave one row with the last count; 0 deletes it', async () => {
    await api.setHabitCount('u1', 'h1', '2026-10-31', 2)
    await api.setHabitCount('u1', 'h1', '2026-10-31', 2)
    await api.setHabitCount('u1', 'h1', '2026-10-31', 3)
    expect(fake.current!.table('habit_logs').map((r) => r.count)).toEqual([3])
    await api.setHabitCount('u1', 'h1', '2026-10-31', 0)
    await api.setHabitCount('u1', 'h1', '2026-10-31', 0)
    expect(fake.current!.table('habit_logs')).toHaveLength(0)
  })

  it('a replayed tick returns the stored completion (primary key or one-off ALREADY_DONE)', async () => {
    const f = fake.current!
    const first = await api.completeTodo('u1', { id: 'c-1', todoId: 't1', day: '2026-10-31' })
    expect(await api.completeTodo('u1', { id: 'c-1', todoId: 't1', day: '2026-10-31' })).toEqual(first)
    expect(f.table('todo_completions')).toHaveLength(1)

    // a one-off ticked elsewhere: the guard says ALREADY_DONE, the existing completion is returned
    f.table('todo_completions').push({ id: 'srv-x', todo_id: 't2', day: '2026-10-29' })
    f.guards.set('todo_completions', (row, rows) => (rows.some((r) => r.todo_id === row.todo_id) ? { code: 'P0001', message: 'ALREADY_DONE' } : null))
    expect(await api.completeTodo('u1', { id: 'c-2', todoId: 't2', day: '2026-10-31' })).toMatchObject({ id: 'srv-x' })
    f.guards.delete('todo_completions')
  })
})
