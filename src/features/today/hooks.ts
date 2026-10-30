import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { toLocalDateISO } from '@/lib/dates'
import { addDays } from '@/lib/recurrence'
import * as api from './api'
import { HISTORY_DAYS, type HabitInput, type HabitLog, type TodoInput } from './types'

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
  return useQuery({ queryKey: todayKeys.logs(from, to), queryFn: () => api.listHabitLogs(from, to) })
}

export function useTodos() {
  return useQuery({ queryKey: todayKeys.todos, queryFn: () => api.loadTodos(addDays(today(), -HISTORY_DAYS)) })
}

/** Points are written by triggers: refresh the profile and the leaderboard after every tick. */
function useAfter() {
  const qc = useQueryClient()
  const { refreshProfile } = useAuth()
  return () => Promise.all([qc.invalidateQueries({ queryKey: todayKeys.all }), qc.invalidateQueries({ queryKey: ['leaderboard'] }), refreshProfile()])
}

export function useSetHabitCount() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const after = useAfter()
  return useMutation({
    mutationFn: ({ habitId, day, count, log }: { habitId: string; day: string; count: number; log: HabitLog | undefined }) =>
      api.setHabitCount(user!.id, habitId, day, count, log),
    // optimistic: the tick shows at once
    onMutate: async ({ habitId, day, count, log }) => {
      await qc.cancelQueries({ queryKey: ['today', 'logs'] })
      const now = new Date().toISOString()
      qc.setQueriesData<HabitLog[]>({ queryKey: ['today', 'logs'] }, (rows) => {
        if (!rows) return rows
        const rest = rows.filter((r) => !(r.habit_id === habitId && r.day === day))
        if (count <= 0) return rest
        return [...rest, { ...(log ?? { id: `tmp-${habitId}-${day}`, user_id: user!.id, habit_id: habitId, day, created_at: now }), count, updated_at: now } as HabitLog]
      })
    },
    onSettled: () => void after(),
  })
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

export function useToggleTodo() {
  const { user } = useAuth()
  const after = useAfter()
  return useMutation({
    mutationFn: ({ todoId, day, completionId }: { todoId: string; day: string; completionId?: string }) =>
      completionId ? api.uncompleteTodo(completionId) : api.completeTodo(user!.id, todoId, day),
    onSuccess: () => void after(),
  })
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
