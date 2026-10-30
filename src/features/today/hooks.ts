import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { toLocalDateISO } from '@/lib/dates'
import { addDays } from '@/lib/recurrence'
import * as api from './api'
import { HISTORY_DAYS, type HabitInput, type HabitLog, type Todo, type TodoCompletion, type TodoInput } from './types'
import { cancelQueuedInsert, newId, nowISO, registerQueued } from '@/lib/offline/queue'
import { useQueuedMutation, useQueuedOps } from '@/lib/offline/hooks'
import {
  applyHabitOps,
  applyTodoOps,
  todayQueue,
  type CompleteTodoVars,
  type HabitCountVars,
  type TodayVars,
  type UncompleteTodoVars,
} from './offline'

export const todayKeys = {
  all: ['today'] as const,
  habits: ['today', 'habits'] as const,
  logs: (from: string, to: string) => ['today', 'logs', from, to] as const,
  todos: ['today', 'todos'] as const,
}

const today = () => toLocalDateISO()

export function useHabits() {
  return useQuery({ queryKey: todayKeys.habits, queryFn: api.listHabits })
}

/** Logs from HISTORY_DAYS ago up to `to` (default today): enough for streaks, heatmaps and the day view. */
export function useHabitLogs(to = today()) {
  const from = addDays(to < today() ? to : today(), -HISTORY_DAYS)
  const q = useQuery({ queryKey: todayKeys.logs(from, to), queryFn: () => api.listHabitLogs(from, to) })
  const ops = useQueuedOps<TodayVars>('today')
  // queued (not yet synced) counts are shown on top of the cached logs
  const data = useMemo(() => applyHabitOps(q.data, from, to, ops), [q.data, from, to, ops])
  return { ...q, data }
}

export function useTodos() {
  const q = useQuery({ queryKey: todayKeys.todos, queryFn: () => api.loadTodos(addDays(today(), -HISTORY_DAYS)) })
  const ops = useQueuedOps<TodayVars>('today')
  const data = useMemo(() => applyTodoOps(q.data, ops), [q.data, ops])
  return { ...q, data }
}

/** Points are written by triggers: refresh the profile and the leaderboard after every tick. */
function useAfter() {
  const qc = useQueryClient()
  const { refreshProfile } = useAuth()
  return () => Promise.all([qc.invalidateQueries({ queryKey: todayKeys.all }), qc.invalidateQueries({ queryKey: ['leaderboard'] }), refreshProfile()])
}

/**
 * Offline queue (src/lib/offline): habit counts and to-do ticks replay in order and survive reloads.
 * The server's row replaces the queued one in the cache on success.
 */
export function registerTodayQueue(qc: QueryClient) {
  registerQueued<HabitLog | null, HabitCountVars>(qc, todayQueue.habitCount, {
    mutationFn: (v) => api.setHabitCount(v.userId, v.habitId, v.day, v.count),
    onSuccess: (row, v) =>
      qc.setQueriesData<HabitLog[]>({ queryKey: ['today', 'logs'] }, (rows) =>
        rows ? [...rows.filter((r) => !(r.habit_id === v.habitId && r.day === v.day)), ...(row ? [row] : [])] : rows,
      ),
    invalidates: [todayKeys.all],
    points: true,
  })
  type TodoData = { todos: Todo[]; completions: TodoCompletion[] }
  registerQueued<TodoCompletion, CompleteTodoVars>(qc, todayQueue.complete, {
    mutationFn: (v) => api.completeTodo(v.userId, { id: v.id, todoId: v.todoId, day: v.day }),
    onSuccess: (row) =>
      qc.setQueryData<TodoData>(todayKeys.todos, (d) => (d && !d.completions.some((c) => c.id === row.id) ? { ...d, completions: [...d.completions, row] } : d)),
    invalidates: [todayKeys.all],
    points: true,
  })
  registerQueued<void, UncompleteTodoVars>(qc, todayQueue.uncomplete, {
    mutationFn: (v) => api.uncompleteTodo(v.id),
    onSuccess: (_d, v) => qc.setQueryData<TodoData>(todayKeys.todos, (d) => (d ? { ...d, completions: d.completions.filter((c) => c.id !== v.id) } : d)),
    invalidates: [todayKeys.all],
    points: true,
  })
}

/** Set a habit's count for a day. Queued: the tick shows at once (overlay) and syncs in order. */
export function useSetHabitCount() {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const stamp = useCallback((v: { habitId: string; day: string; count: number }): HabitCountVars => ({ ...v, count: Math.max(0, v.count), userId, at: nowISO() }), [userId])
  return useQueuedMutation<HabitLog | null, { habitId: string; day: string; count: number }, HabitCountVars>(todayQueue.habitCount, stamp)
}

export function useSaveHabit() {
  const { user } = useAuth()
  const after = useAfter()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: HabitInput }) => (id ? api.updateHabit(id, input) : api.createHabit(user!.id, input, today())),
    onSuccess: () => void after(),
  })
}

export function useArchiveHabit() {
  const after = useAfter()
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => api.updateHabit(id, { archived_at: archived ? new Date().toISOString() : null }),
    onSuccess: () => void after(),
  })
}

export function useDeleteHabit() {
  const after = useAfter()
  return useMutation({ mutationFn: (id: string) => api.deleteHabit(id), onSuccess: () => void after() })
}

/** Tick / un-tick one to-do occurrence. Queued; an un-tick of a tick that never reached the server just drops it. */
export function useToggleTodo() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const stampDone = useCallback((v: { todoId: string; day: string }): CompleteTodoVars => ({ ...v, id: newId(), userId, at: nowISO() }), [userId])
  const stampUndo = useCallback((v: { id: string; todoId: string }): UncompleteTodoVars => ({ ...v, userId, at: nowISO() }), [userId])
  const done = useQueuedMutation<TodoCompletion, { todoId: string; day: string }, CompleteTodoVars>(todayQueue.complete, stampDone)
  const undo = useQueuedMutation<void, { id: string; todoId: string }, UncompleteTodoVars>(todayQueue.uncomplete, stampUndo)
  const { mutate: complete } = done
  const { mutate: uncomplete } = undo
  const mutate = useCallback(
    ({ todoId, day, completionId }: { todoId: string; day: string; completionId?: string }) => {
      if (!completionId) return void complete({ todoId, day })
      if (cancelQueuedInsert(qc, todayQueue.complete, completionId)) return
      uncomplete({ id: completionId, todoId })
    },
    [complete, uncomplete, qc],
  )
  return { mutate, isPending: done.isPending || undo.isPending, error: done.error ?? undo.error }
}

export function useSaveTodo() {
  const { user } = useAuth()
  const after = useAfter()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: TodoInput }) => (id ? api.updateTodo(id, input, today()) : api.createTodo(user!.id, input, today())),
    onSuccess: () => void after(),
  })
}

export function useStopTodo() {
  const after = useAfter()
  return useMutation({ mutationFn: (id: string) => api.stopTodo(id), onSuccess: () => void after() })
}

export function useDeleteTodo() {
  const after = useAfter()
  return useMutation({ mutationFn: (id: string) => api.deleteTodo(id), onSuccess: () => void after() })
}
