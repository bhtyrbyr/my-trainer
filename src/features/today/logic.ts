import { addDays, matches, streak, weekCountDone, weekStart } from '@/lib/recurrence'
import type { Habit, HabitLog, Todo, TodoCompletion } from './types'

/** Local day (Europe/Istanbul is the product's timezone; the device is assumed to be in it). */
function localDay(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function activeOn(h: Habit, day: string): boolean {
  return !h.archived_at || localDay(h.archived_at) > day
}

export function logsByHabit(logs: HabitLog[]): Map<string, Map<string, HabitLog>> {
  const m = new Map<string, Map<string, HabitLog>>()
  for (const l of logs) {
    if (!m.has(l.habit_id)) m.set(l.habit_id, new Map())
    m.get(l.habit_id)!.set(l.day, l)
  }
  return m
}

export function doneDays(h: Habit, byDay: Map<string, HabitLog> | undefined): Set<string> {
  const s = new Set<string>()
  for (const [day, l] of byDay ?? []) if (l.count >= h.target_count) s.add(day)
  return s
}

export type HabitItem = { habit: Habit; log: HabitLog | undefined; count: number; done: boolean; weekDone?: number }

/**
 * Habits due on `day`. weekly_count habits stay listed while the week's quota is open, and on the days
 * they were done.
 */
export function habitsFor(day: string, habits: Habit[], logs: HabitLog[]): HabitItem[] {
  const by = logsByHabit(logs)
  const out: HabitItem[] = []
  for (const h of habits) {
    if (!activeOn(h, day) || !matches(h.rule, h.starts_on, day)) continue
    const log = by.get(h.id)?.get(day)
    const count = log?.count ?? 0
    const done = count >= h.target_count
    if (h.rule.type === 'weekly_count') {
      const days = doneDays(h, by.get(h.id))
      const weekDone = weekCountDone(days, addDays(weekStart(day), 6))
      if (!done && weekDone >= h.rule.n) continue
      out.push({ habit: h, log, count, done, weekDone })
      continue
    }
    out.push({ habit: h, log, count, done })
  }
  return out
}

export type TodoItem = { todo: Todo; day: string; completion: TodoCompletion | undefined; overdue: boolean }

function completionMap(completions: TodoCompletion[]): Map<string, TodoCompletion> {
  return new Map(completions.map((c) => [`${c.todo_id}:${c.day}`, c]))
}

/** The one completion of a one-off todo, wherever it falls. */
function oneOffCompletion(t: Todo, completions: TodoCompletion[]): TodoCompletion | undefined {
  return completions.find((c) => c.todo_id === t.id)
}

/**
 * To-dos for `day`: one-offs due that day, recurring occurrences, and on today also overdue open
 * one-offs (carried over) and one-offs ticked today.
 */
export function todosFor(day: string, today: string, todos: Todo[], completions: TodoCompletion[]): TodoItem[] {
  const cm = completionMap(completions)
  const out: TodoItem[] = []
  for (const t of todos) {
    if (t.rule) {
      if (t.archived_at && localDay(t.archived_at) <= day) continue
      if (!matches(t.rule, t.starts_on, day)) continue
      out.push({ todo: t, day, completion: cm.get(`${t.id}:${day}`), overdue: false })
      continue
    }
    const c = oneOffCompletion(t, completions)
    if (t.due_on === day) {
      out.push({ todo: t, day, completion: c, overdue: false })
    } else if (day === today && t.due_on !== null && t.due_on < today && (!c || c.completed_on === today)) {
      out.push({ todo: t, day: t.due_on, completion: c, overdue: !c })
    }
  }
  return sortTodoItems(out)
}

export function sortTodoItems(items: TodoItem[]): TodoItem[] {
  return [...items].sort(
    (a, b) =>
      Number(Boolean(a.completion)) - Number(Boolean(b.completion)) ||
      Number(b.overdue) - Number(a.overdue) ||
      b.todo.priority - a.todo.priority ||
      a.todo.created_at.localeCompare(b.todo.created_at),
  )
}

export type TodoGroups = { overdue: TodoItem[]; today: TodoItem[]; upcoming: TodoItem[]; someday: TodoItem[]; recurring: Todo[]; done: TodoItem[] }

/** The to-do page: open one-offs by when they are due, recurring templates, recently done. */
export function groupTodos(todos: Todo[], completions: TodoCompletion[], today: string): TodoGroups {
  const g: TodoGroups = { overdue: [], today: [], upcoming: [], someday: [], recurring: [], done: [] }
  const doneSince = addDays(today, -30)
  for (const t of todos) {
    if (t.rule) {
      if (!t.archived_at) g.recurring.push(t)
      continue
    }
    const c = oneOffCompletion(t, completions)
    const item: TodoItem = { todo: t, day: t.due_on ?? today, completion: c, overdue: false }
    if (c) {
      if (c.completed_on >= doneSince) g.done.push(item)
    } else if (t.due_on === null) g.someday.push(item)
    else if (t.due_on < today) g.overdue.push({ ...item, overdue: true })
    else if (t.due_on === today) g.today.push(item)
    else g.upcoming.push(item)
  }
  g.upcoming.sort((a, b) => a.day.localeCompare(b.day) || b.todo.priority - a.todo.priority)
  g.overdue.sort((a, b) => a.day.localeCompare(b.day))
  g.today = sortTodoItems(g.today)
  g.someday = sortTodoItems(g.someday)
  g.done.sort((a, b) => b.completion!.completed_on.localeCompare(a.completion!.completed_on))
  return g
}

export function habitStreak(h: Habit, logs: HabitLog[], today: string): number {
  return streak(h.rule, h.starts_on, doneDays(h, logsByHabit(logs).get(h.id)), today)
}

export type HeatCell = { day: string; state: 'done' | 'partial' | 'missed' | 'off' | 'future' | 'before' }

/** `weeks` full ISO weeks ending with the current one, Monday first. */
export function heatmap(h: Habit, logs: HabitLog[], today: string, weeks = 5): HeatCell[] {
  const by = logsByHabit(logs).get(h.id)
  const cells: HeatCell[] = []
  const start = addDays(weekStart(today), -7 * (weeks - 1))
  for (let i = 0; i < weeks * 7; i++) {
    const day = addDays(start, i)
    const count = by?.get(day)?.count ?? 0
    let state: HeatCell['state']
    if (day > today) state = 'future'
    else if (day < h.starts_on) state = 'before'
    else if (count >= h.target_count) state = 'done'
    else if (count > 0) state = 'partial'
    else if (h.rule.type !== 'weekly_count' && matches(h.rule, h.starts_on, day) && day < today) state = 'missed'
    else state = 'off'
    cells.push({ day, state })
  }
  return cells
}
