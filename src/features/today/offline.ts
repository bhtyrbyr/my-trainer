// Queued habit / to-do writes (offline queue, src/lib/offline) and the pure overlays for the day views.
import { toLocalDateISO } from '@/lib/dates'
import { queuedKey, type QueuedOp, type QueuedVars } from '@/lib/offline/queue'
import type { HabitLog, Todo, TodoCompletion } from './types'

export const todayQueue = {
  habitCount: queuedKey('today', 'setHabitCount'),
  complete: queuedKey('today', 'completeTodo'),
  uncomplete: queuedKey('today', 'uncompleteTodo'),
}

/** Absolute count for one habit and day (0 removes the log): replaying it any number of times is the same write. */
export type HabitCountVars = QueuedVars & { habitId: string; day: string; count: number }
export type CompleteTodoVars = QueuedVars & { id: string; todoId: string; day: string }
export type UncompleteTodoVars = QueuedVars & { id: string; todoId: string }
export type TodayVars = HabitCountVars | CompleteTodoVars | UncompleteTodoVars

/** Habit logs in [from, to] with queued counts applied in order (last write per habit/day wins). */
export function applyHabitOps(rows: HabitLog[] | undefined, from: string, to: string, ops: readonly QueuedOp<TodayVars>[]): HabitLog[] | undefined {
  const mine = ops.filter((o) => o.op === 'setHabitCount' && 'habitId' in o.vars && o.vars.day >= from && o.vars.day <= to)
  if (!rows || !mine.length) return rows
  let out = rows
  for (const { vars } of mine) {
    const v = vars as HabitCountVars
    const prev = out.find((r) => r.habit_id === v.habitId && r.day === v.day)
    out = out.filter((r) => r !== prev)
    if (v.count > 0) {
      out = [
        ...out,
        { id: prev?.id ?? `queued:${v.habitId}:${v.day}`, user_id: v.userId, habit_id: v.habitId, day: v.day, count: v.count, created_at: prev?.created_at ?? v.at, updated_at: v.at },
      ]
    }
  }
  return out
}

export function pendingCompletion(v: CompleteTodoVars): TodoCompletion {
  return { id: v.id, user_id: v.userId, todo_id: v.todoId, day: v.day, completed_on: toLocalDateISO(new Date(v.at)), created_at: v.at }
}

type TodoData = { todos: Todo[]; completions: TodoCompletion[] }

/** To-dos with queued ticks / un-ticks applied in order. */
export function applyTodoOps<D extends TodoData | undefined>(data: D, ops: readonly QueuedOp<TodayVars>[]): D {
  const mine = ops.filter((o) => o.op === 'completeTodo' || o.op === 'uncompleteTodo')
  if (!data || !mine.length) return data
  let completions = data.completions
  for (const { op, vars } of mine) {
    const v = vars as CompleteTodoVars
    if (op === 'completeTodo') {
      if (!completions.some((c) => c.id === v.id)) completions = [...completions, pendingCompletion(v)]
    } else completions = completions.filter((c) => c.id !== v.id)
  }
  return { ...data, completions }
}
