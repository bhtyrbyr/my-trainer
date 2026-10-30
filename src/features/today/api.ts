import { supabase } from '@/lib/supabase'
import type { Json } from '@/lib/database.types'
import type { Habit, HabitInput, HabitLog, Todo, TodoCompletion, TodoInput } from './types'

// RLS scopes every read to the caller; no client-side user_id filters (CLAUDE.md rule 10).

export async function listHabits(): Promise<Habit[]> {
  const { data, error } = await supabase.from('habits').select('*').order('sort_order').order('created_at')
  if (error) throw error
  return (data ?? []) as unknown as Habit[]
}

export async function listHabitLogs(from: string, to: string): Promise<HabitLog[]> {
  const { data, error } = await supabase.from('habit_logs').select('*').gte('day', from).lte('day', to)
  if (error) throw error
  return data ?? []
}

export async function createHabit(userId: string, input: HabitInput, startsOn: string): Promise<void> {
  const { error } = await supabase.from('habits').insert({ user_id: userId, ...input, rule: input.rule as unknown as NonNullable<Json>, starts_on: startsOn })
  if (error) throw error
}

export async function updateHabit(id: string, patch: Partial<HabitInput> & { archived_at?: string | null }): Promise<void> {
  const { rule, ...rest } = patch
  const { error } = await supabase
    .from('habits')
    .update({ ...rest, ...(rule ? { rule: rule as unknown as NonNullable<Json> } : {}) })
    .eq('id', id)
  if (error) throw error
}

export async function deleteHabit(id: string): Promise<void> {
  const { error } = await supabase.from('habits').delete().eq('id', id)
  if (error) throw error
}

/** Set a habit's count for a day: 0 removes the log (and its points). */
export async function setHabitCount(userId: string, habitId: string, day: string, count: number, existing: HabitLog | undefined): Promise<void> {
  if (count <= 0) {
    if (!existing) return
    const { error } = await supabase.from('habit_logs').delete().eq('id', existing.id)
    if (error) throw error
    return
  }
  if (existing) {
    const { error } = await supabase.from('habit_logs').update({ count }).eq('id', existing.id)
    if (error) throw error
    return
  }
  const { error } = await supabase.from('habit_logs').insert({ user_id: userId, habit_id: habitId, day, count })
  if (error) throw error
}

/**
 * Todos plus their completions. Recurring completions come from the recent window; a one-off is open
 * or done forever, so its single completion is fetched even when it is older than the window.
 */
export async function loadTodos(since: string): Promise<{ todos: Todo[]; completions: TodoCompletion[] }> {
  const [{ data: todos, error }, { data: recent, error: cErr }] = await Promise.all([
    supabase.from('todos').select('*').order('created_at'),
    supabase.from('todo_completions').select('*').gte('day', since),
  ])
  if (error) throw error
  if (cErr) throw cErr
  const list = (todos ?? []) as unknown as Todo[]
  const completions = recent ?? []
  const seen = new Set(completions.map((c) => c.todo_id))
  const missing = list.filter((t) => !t.rule && !seen.has(t.id) && (t.due_on === null || t.due_on < since)).map((t) => t.id)
  for (let i = 0; i < missing.length; i += 200) {
    const { data, error: oErr } = await supabase.from('todo_completions').select('*').in('todo_id', missing.slice(i, i + 200))
    if (oErr) throw oErr
    completions.push(...(data ?? []))
  }
  return { todos: list, completions }
}

/**
 * The sheet's `due_on` means "due day" for a one-off and "starts on" for a recurring to-do; the table
 * keeps them apart (recurring rows have due_on null).
 */
function todoColumns(input: TodoInput, today: string) {
  const { rule, due_on, ...rest } = input
  return rule
    ? { ...rest, rule: rule as unknown as Json, due_on: null, starts_on: due_on ?? today }
    : { ...rest, rule: null, due_on }
}

export async function createTodo(userId: string, input: TodoInput, today: string): Promise<void> {
  const { error } = await supabase.from('todos').insert({ user_id: userId, ...todoColumns(input, today) })
  if (error) throw error
}

export async function updateTodo(id: string, input: TodoInput, today: string): Promise<void> {
  const { error } = await supabase.from('todos').update(todoColumns(input, today)).eq('id', id)
  if (error) throw error
}

export async function stopTodo(id: string): Promise<void> {
  const { error } = await supabase.from('todos').update({ archived_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function deleteTodo(id: string): Promise<void> {
  const { error } = await supabase.from('todos').delete().eq('id', id)
  if (error) throw error
}

export async function completeTodo(userId: string, todoId: string, day: string): Promise<void> {
  const { error } = await supabase.from('todo_completions').insert({ user_id: userId, todo_id: todoId, day })
  if (error) throw error
}

export async function uncompleteTodo(completionId: string): Promise<void> {
  const { error } = await supabase.from('todo_completions').delete().eq('id', completionId)
  if (error) throw error
}
