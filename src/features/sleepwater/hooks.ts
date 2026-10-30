import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { addDays, format, parseISO } from 'date-fns'
import { useAuth } from '@/features/auth/AuthProvider'
import * as api from './api'
import { useIsSleepWaterPreview } from './previewContext'
import type { SleepEntry, WaterEntry } from './types'
import { cancelQueuedInsert, newId, nowISO, registerQueued } from '@/lib/offline/queue'
import { useQueuedMutation, useQueuedOps } from '@/lib/offline/hooks'
import { applyWaterOps, pendingWaterRow, waterQueue, type AddWaterVars, type DeleteWaterVars, type WaterVars } from './offline'

export const sleepWaterKeys = {
  all: ['sleepwater'] as const,
  water: (day: string) => ['sleepwater', 'water', day] as const,
  sleepWeek: (day: string) => ['sleepwater', 'sleep', day] as const,
}

/** The day's drinks; queued (not yet synced) adds and removes are shown on top. */
export function useWater(day: string) {
  const preview = useIsSleepWaterPreview()
  const q = useQuery({ queryKey: sleepWaterKeys.water(day), queryFn: () => api.listWater(day), enabled: !preview })
  const ops = useQueuedOps<WaterVars>('sleepwater')
  const data = useMemo(() => applyWaterOps(q.data, day, ops), [q.data, day, ops])
  return { ...q, data }
}

/** The 7 nights ending on `day` (the day's own night is the last row when logged). */
export function useSleepWeek(day: string) {
  const preview = useIsSleepWaterPreview()
  const from = format(addDays(parseISO(day), -6), 'yyyy-MM-dd')
  return useQuery({ queryKey: sleepWaterKeys.sleepWeek(day), queryFn: () => api.listSleep(from, day), enabled: !preview })
}

/** Water goal and sleep points are written by triggers: refresh the profile and the leaderboard. */
function useAfter() {
  const qc = useQueryClient()
  const { refreshProfile } = useAuth()
  return () => Promise.all([qc.invalidateQueries({ queryKey: sleepWaterKeys.all }), qc.invalidateQueries({ queryKey: ['leaderboard'] }), refreshProfile()])
}

/** Offline queue (src/lib/offline): water adds/removes replay in order and survive reloads. */
export function registerSleepWaterQueue(qc: QueryClient) {
  const patch = (day: string, fn: (rows: WaterEntry[]) => WaterEntry[]) =>
    qc.setQueryData<WaterEntry[]>(sleepWaterKeys.water(day), (rows) => (rows ? fn(rows) : rows))
  registerQueued<WaterEntry, AddWaterVars>(qc, waterQueue.add, {
    mutationFn: (v) => api.addWater(v.userId, { id: v.id, day: v.day, ml: v.ml, loggedAt: v.at }),
    onSuccess: (row, v) => patch(v.day, (rows) => (rows.some((r) => r.id === row.id) ? rows : [...rows, row])),
    invalidates: [sleepWaterKeys.all],
    points: true,
  })
  registerQueued<void, DeleteWaterVars>(qc, waterQueue.remove, {
    mutationFn: (v) => api.deleteWater(v.id),
    onSuccess: (_d, v) => patch(v.day, (rows) => rows.filter((r) => r.id !== v.id)),
    invalidates: [sleepWaterKeys.all],
    points: true,
  })
}

export function useAddWater() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const preview = useIsSleepWaterPreview()
  const userId = user?.id ?? ''
  const stamp = useCallback((w: { day: string; ml: number }): AddWaterVars => ({ ...w, id: newId(), userId, at: nowISO() }), [userId])
  return useQueuedMutation<WaterEntry, { day: string; ml: number }, AddWaterVars>(
    waterQueue.add,
    stamp,
    preview
      ? {
          mutationFn: async (v) => {
            const row = { ...pendingWaterRow(v), user_id: 'preview' }
            qc.setQueryData<WaterEntry[]>(sleepWaterKeys.water(v.day), (rows = []) => [...rows, row])
            return row
          },
        }
      : undefined,
  )
}

/** Removes a drink; one that never reached the server is simply dropped from the queue. */
export function useDeleteWater() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const preview = useIsSleepWaterPreview()
  const userId = user?.id ?? ''
  const stamp = useCallback((w: { id: string; day: string }): DeleteWaterVars => ({ ...w, userId, at: nowISO() }), [userId])
  const m = useQueuedMutation<void, { id: string; day: string }, DeleteWaterVars>(
    waterQueue.remove,
    stamp,
    preview
      ? {
          mutationFn: async ({ id, day }) => {
            qc.setQueryData<WaterEntry[]>(sleepWaterKeys.water(day), (rows = []) => rows.filter((r) => r.id !== id))
          },
        }
      : undefined,
  )
  const { mutate: queue } = m
  const mutate = useCallback(
    (w: { id: string; day: string }, opts?: Parameters<typeof queue>[1]) => {
      if (!preview && cancelQueuedInsert(qc, waterQueue.add, w.id)) return stamp(w)
      return queue(w, opts)
    },
    [preview, qc, queue, stamp],
  )
  return { ...m, mutate }
}

export function useSaveSleep() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const preview = useIsSleepWaterPreview()
  const after = useAfter()
  return useMutation({
    mutationFn: async ({ day, bedAt, wakeAt, quality }: { day: string; bedAt: Date; wakeAt: Date; quality: number | null }) => {
      if (!preview) return api.saveSleep(user!.id, day, bedAt, wakeAt, quality)
      const now = new Date().toISOString()
      qc.setQueryData<SleepEntry[]>(sleepWaterKeys.sleepWeek(day), (rows = []) => [
        ...rows.filter((r) => r.sleep_on !== day),
        {
          id: `p-${day}`,
          user_id: 'preview',
          sleep_on: day,
          bed_at: bedAt.toISOString(),
          wake_at: wakeAt.toISOString(),
          duration_min: Math.round((wakeAt.getTime() - bedAt.getTime()) / 60000),
          quality,
          note: null,
          created_at: now,
          updated_at: now,
        },
      ])
    },
    onSuccess: () => {
      if (!preview) void after()
    },
  })
}

export function useDeleteSleep() {
  const qc = useQueryClient()
  const preview = useIsSleepWaterPreview()
  const after = useAfter()
  return useMutation({
    mutationFn: async ({ id, day }: { id: string; day: string }) => {
      if (!preview) return api.deleteSleep(id)
      qc.setQueryData<SleepEntry[]>(sleepWaterKeys.sleepWeek(day), (rows = []) => rows.filter((r) => r.id !== id))
    },
    onSuccess: () => {
      if (!preview) void after()
    },
  })
}
