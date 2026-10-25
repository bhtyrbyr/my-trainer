import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays, format, parseISO } from 'date-fns'
import { useAuth } from '@/features/auth/AuthProvider'
import * as api from './api'
import { useIsSleepWaterPreview } from './previewContext'
import type { SleepEntry, WaterEntry } from './types'

export const sleepWaterKeys = {
  all: ['sleepwater'] as const,
  water: (day: string) => ['sleepwater', 'water', day] as const,
  sleepWeek: (day: string) => ['sleepwater', 'sleep', day] as const,
}

export function useWater(day: string) {
  const preview = useIsSleepWaterPreview()
  return useQuery({ queryKey: sleepWaterKeys.water(day), queryFn: () => api.listWater(day), enabled: !preview })
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

export function useAddWater() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const preview = useIsSleepWaterPreview()
  const after = useAfter()
  return useMutation({
    mutationFn: async ({ day, ml }: { day: string; ml: number }) => {
      if (!preview) return api.addWater(user!.id, day, ml)
      const now = new Date().toISOString()
      qc.setQueryData<WaterEntry[]>(sleepWaterKeys.water(day), (rows = []) => [
        ...rows,
        { id: `p-${Date.now()}`, user_id: 'preview', drunk_on: day, amount_ml: ml, logged_at: now, created_at: now },
      ])
    },
    onSuccess: () => {
      if (!preview) void after()
    },
  })
}

export function useDeleteWater() {
  const qc = useQueryClient()
  const preview = useIsSleepWaterPreview()
  const after = useAfter()
  return useMutation({
    mutationFn: async ({ id, day }: { id: string; day: string }) => {
      if (!preview) return api.deleteWater(id)
      qc.setQueryData<WaterEntry[]>(sleepWaterKeys.water(day), (rows = []) => rows.filter((r) => r.id !== id))
    },
    onSuccess: () => {
      if (!preview) void after()
    },
  })
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
