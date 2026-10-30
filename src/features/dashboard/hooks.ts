import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { habitsFor, todosFor, useHabitLogs, useHabits, useTodos } from '@/features/today'
import { toLocalDateISO } from '@/lib/dates'
import { addDays } from '@/lib/recurrence'
import { fetchTrainedParts, fetchWeekSummary } from './api'
import { lastTrainedByPart, parseDismissed, ROTATION_DAYS, weekStartOf, withDismissed } from './logic'
import { useIsDashboardPreview } from './previewContext'

export const dashboardKeys = {
  all: ['dashboard'] as const,
  week: (weekStart: string) => ['dashboard', 'week', weekStart] as const,
  parts: (today: string) => ['dashboard', 'parts', today] as const,
}

/** get_week_summary for the week `offset` weeks from this one (0 = this week, -1 = last week). */
export function useWeekSummary(offset = 0) {
  const preview = useIsDashboardPreview()
  const start = weekStartOf(toLocalDateISO(), offset)
  return useQuery({
    queryKey: dashboardKeys.week(start),
    queryFn: () => fetchWeekSummary(start),
    enabled: !preview,
    // past weeks barely change; this week follows every log
    staleTime: offset < 0 ? 30 * 60_000 : 30_000,
  })
}

/** Body part -> last local day trained, over the rotation window. */
export function useTrainedParts() {
  const preview = useIsDashboardPreview()
  const today = toLocalDateISO()
  return useQuery({
    queryKey: dashboardKeys.parts(today),
    queryFn: async () => {
      const [y, m, d] = addDays(today, -ROTATION_DAYS).split('-').map(Number)
      return lastTrainedByPart(await fetchTrainedParts(new Date(y, m - 1, d).toISOString()))
    },
    enabled: !preview,
    staleTime: 5 * 60_000,
  })
}

/** Today's habits (due / done) and to-dos (open / done), from the shared Track queries. */
export function useTodayAgenda() {
  const today = toLocalDateISO()
  const habits = useHabits()
  const logs = useHabitLogs()
  const todos = useTodos()
  const data = useMemo(() => {
    if (!habits.data || !logs.data || !todos.data) return undefined
    const h = habitsFor(today, habits.data, logs.data)
    const td = todosFor(today, today, todos.data.todos, todos.data.completions)
    return {
      habitsDue: h.length,
      habitsDone: h.filter((x) => x.done).length,
      todosDue: td.length,
      todosDone: td.filter((x) => x.completion).length,
    }
  }, [today, habits.data, logs.data, todos.data])
  return { data, isLoading: habits.isLoading || logs.isLoading || todos.isLoading }
}

const DISMISSED_KEY = 'mt.dash.dismissed.'

/** Suggestions dismissed "for today", remembered per user on this device. Storage failures are ignored. */
export function useDismissedSuggestions() {
  const { user } = useAuth()
  const today = toLocalDateISO()
  const key = DISMISSED_KEY + (user?.id ?? 'anon')
  const [raw, setRaw] = useState<string | null>(() => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  })
  const dismissed = useMemo(() => parseDismissed(raw, today), [raw, today])
  const dismiss = useCallback(
    (id: string) => {
      const next = withDismissed(raw, today, id)
      setRaw(next)
      try {
        localStorage.setItem(key, next)
      } catch {
        /* private mode / quota: dismissed for this visit only */
      }
    },
    [raw, today, key],
  )
  return { dismissed, dismiss }
}
