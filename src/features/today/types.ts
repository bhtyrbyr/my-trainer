import type { Tables } from '@/lib/database.types'
import type { RecurrenceRule } from '@/lib/recurrence'

export type Habit = Omit<Tables<'habits'>, 'rule'> & { rule: RecurrenceRule }
export type HabitLog = Tables<'habit_logs'>
export type Todo = Omit<Tables<'todos'>, 'rule'> & { rule: RecurrenceRule | null }
export type TodoCompletion = Tables<'todo_completions'>

/** 0 normal, 1 high, 2 urgent (todos.priority). */
export const PRIORITIES = [0, 1, 2] as const
export type Priority = (typeof PRIORITIES)[number]

export type HabitInput = {
  name: string
  emoji: string | null
  rule: RecurrenceRule
  target_count: number
  unit: string | null
}

export type TodoInput = {
  title: string
  note: string | null
  priority: Priority
  due_on: string | null
  rule: RecurrenceRule | null
}

/** How far back the screens load habit logs (streaks, heatmaps) and to-do completions. */
export const HISTORY_DAYS = 120
