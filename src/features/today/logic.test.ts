import { describe, expect, it } from 'vitest'
import { groupTodos, habitStreak, habitsFor, heatmap, todosFor } from './logic'
import type { Habit, HabitLog, Todo, TodoCompletion } from './types'

const T = '2026-11-04T09:00:00Z'
const habit = (p: Partial<Habit>): Habit => ({
  id: 'h1',
  user_id: 'u',
  name: 'Kitap oku',
  emoji: null,
  rule: { type: 'daily' },
  target_count: 1,
  unit: null,
  starts_on: '2026-11-01',
  remind_at: null,
  sort_order: 0,
  archived_at: null,
  created_at: T,
  updated_at: T,
  ...p,
})
const log = (habit_id: string, day: string, count = 1): HabitLog => ({ id: `${habit_id}-${day}`, user_id: 'u', habit_id, day, count, created_at: T, updated_at: T })
const todo = (p: Partial<Todo>): Todo => ({
  id: 't1',
  user_id: 'u',
  title: 'Fatura',
  note: null,
  priority: 0,
  due_on: null,
  rule: null,
  starts_on: '2026-11-01',
  remind_at: null,
  archived_at: null,
  created_at: T,
  updated_at: T,
  ...p,
})
const done = (todo_id: string, day: string, completed_on = day): TodoCompletion => ({ id: `${todo_id}-${day}`, user_id: 'u', todo_id, day, completed_on, created_at: T })

describe('habitsFor', () => {
  it('lists due habits with counter progress', () => {
    const items = habitsFor('2026-11-04', [habit({ target_count: 20, unit: 'sayfa' })], [log('h1', '2026-11-04', 12)])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ count: 12, done: false })
  })

  it('hides a weekly quota habit once the week is met, except on done days', () => {
    const h = habit({ rule: { type: 'weekly_count', n: 2 } })
    const logs = [log('h1', '2026-11-02'), log('h1', '2026-11-03')]
    expect(habitsFor('2026-11-04', [h], logs)).toHaveLength(0)
    expect(habitsFor('2026-11-03', [h], logs)[0]).toMatchObject({ done: true, weekDone: 2 })
  })

  it('skips archived and not-yet-started habits', () => {
    expect(habitsFor('2026-10-31', [habit({})], [])).toHaveLength(0)
    expect(habitsFor('2026-11-04', [habit({ archived_at: '2026-11-03T10:00:00' })], [])).toHaveLength(0)
  })
})

describe('todosFor', () => {
  const today = '2026-11-04'
  it('carries open overdue one-offs to today only', () => {
    const t = todo({ due_on: '2026-11-01' })
    expect(todosFor(today, today, [t], [])[0]).toMatchObject({ overdue: true, day: '2026-11-01' })
    expect(todosFor('2026-11-03', today, [t], [])).toHaveLength(0)
  })

  it('keeps an overdue one-off ticked today on today, done', () => {
    const t = todo({ due_on: '2026-11-01' })
    const items = todosFor(today, today, [t], [done('t1', '2026-11-01', today)])
    expect(items[0]).toMatchObject({ overdue: false })
    expect(items[0].completion).toBeDefined()
  })

  it('lists recurring occurrences and sorts open, overdue and urgent first', () => {
    const r = todo({ id: 'r', rule: { type: 'weekly', days: [3] } })
    const o = todo({ id: 'o', due_on: '2026-11-02' })
    const u = todo({ id: 'u', due_on: today, priority: 2 })
    const items = todosFor(today, today, [r, o, u], [done('r', today)])
    expect(items.map((i) => i.todo.id)).toEqual(['o', 'u', 'r'])
  })
})

describe('groupTodos', () => {
  it('groups by due date and keeps recently done', () => {
    const g = groupTodos(
      [todo({ id: 'a', due_on: '2026-11-01' }), todo({ id: 'b', due_on: '2026-11-04' }), todo({ id: 'c', due_on: '2026-11-09' }), todo({ id: 'd' }), todo({ id: 'e', rule: { type: 'daily' } }), todo({ id: 'f' })],
      [done('f', '2026-11-03')],
      '2026-11-04',
    )
    expect(g.overdue.map((i) => i.todo.id)).toEqual(['a'])
    expect(g.today.map((i) => i.todo.id)).toEqual(['b'])
    expect(g.upcoming.map((i) => i.todo.id)).toEqual(['c'])
    expect(g.someday.map((i) => i.todo.id)).toEqual(['d'])
    expect(g.recurring.map((t) => t.id)).toEqual(['e'])
    expect(g.done.map((i) => i.todo.id)).toEqual(['f'])
  })
})

describe('streak and heatmap', () => {
  it('counts completed days at the target only', () => {
    const h = habit({ target_count: 2 })
    const logs = [log('h1', '2026-11-02', 2), log('h1', '2026-11-03', 2), log('h1', '2026-11-04', 1)]
    expect(habitStreak(h, logs, '2026-11-04')).toBe(2)
  })

  it('marks heatmap cells', () => {
    const cells = heatmap(habit({}), [log('h1', '2026-11-02')], '2026-11-04', 1)
    expect(cells.map((c) => c.state)).toEqual(['done', 'missed', 'off', 'future', 'future', 'future', 'future'])
  })
})
