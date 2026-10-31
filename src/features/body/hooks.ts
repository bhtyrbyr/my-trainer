import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import * as api from './api'
import { useIsBodyPreview } from './previewContext'
import type { BodyMetric, BodyMetricInput } from './types'

export const bodyKeys = {
  all: ['body'] as const,
  metrics: ['body', 'metrics'] as const,
  target: ['body', 'target'] as const,
}

export function useBodyMetrics() {
  const preview = useIsBodyPreview()
  return useQuery({ queryKey: bodyKeys.metrics, queryFn: api.listBodyMetrics, enabled: !preview })
}

export function usePrivateWeights() {
  const preview = useIsBodyPreview()
  // profile_private (target weight, height): not written to IndexedDB
  return useQuery({ queryKey: bodyKeys.target, queryFn: api.getPrivateWeights, enabled: !preview, meta: { persist: false } })
}

/** Points changed server-side (weight / measurement logs): refresh the profile, leaderboard and energy. */
function useAfterBodyChange() {
  const qc = useQueryClient()
  const { refreshProfile } = useAuth()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: bodyKeys.all }),
      qc.invalidateQueries({ queryKey: ['leaderboard'] }),
      refreshProfile(),
    ])
}

export function useSaveBodyMetric() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const preview = useIsBodyPreview()
  const after = useAfterBodyChange()
  return useMutation({
    mutationFn: async (input: BodyMetricInput) => {
      if (!preview) return api.saveBodyMetric(user!.id, input)
      qc.setQueryData<BodyMetric[]>(bodyKeys.metrics, (rows = []) => {
        const existing = rows.find((r) => r.measured_on === input.measured_on)
        const merged = { ...(existing ?? emptyRow(input.measured_on)), ...input } as BodyMetric
        return [merged, ...rows.filter((r) => r.measured_on !== input.measured_on)].sort((a, b) => b.measured_on.localeCompare(a.measured_on))
      })
    },
    onSuccess: () => {
      if (!preview) void after()
    },
  })
}

export function useDeleteBodyMetric() {
  const qc = useQueryClient()
  const preview = useIsBodyPreview()
  const after = useAfterBodyChange()
  return useMutation({
    mutationFn: async (id: string) => {
      if (!preview) return api.deleteBodyMetric(id)
      qc.setQueryData<BodyMetric[]>(bodyKeys.metrics, (rows = []) => rows.filter((r) => r.id !== id))
    },
    onSuccess: () => {
      if (!preview) void after()
    },
  })
}

export function useSetTargetWeight() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const preview = useIsBodyPreview()
  return useMutation({
    mutationFn: async (kg: number | null) => {
      if (!preview) return api.setTargetWeight(user!.id, kg)
      qc.setQueryData<{ target: number | null; start: number | null; height: number | null; sex: string | null }>(bodyKeys.target, (w) => ({ start: w?.start ?? null, height: w?.height ?? null, sex: w?.sex ?? null, target: kg }))
    },
    onSuccess: () => {
      if (!preview) void qc.invalidateQueries({ queryKey: bodyKeys.target })
    },
  })
}

function emptyRow(day: string): BodyMetric {
  return {
    id: `preview-${day}`,
    user_id: 'preview',
    measured_on: day,
    weight_kg: null,
    waist_cm: null,
    chest_cm: null,
    arm_cm: null,
    hip_cm: null,
    thigh_cm: null,
    neck_cm: null,
    note: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export function useSetHeight() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const preview = useIsBodyPreview()
  return useMutation({
    mutationFn: async (cm: number | null) => {
      if (!preview) return api.setHeight(user!.id, cm)
      qc.setQueryData<{ target: number | null; start: number | null; height: number | null; sex: string | null }>(bodyKeys.target, (w) => ({ target: w?.target ?? null, start: w?.start ?? null, sex: w?.sex ?? null, height: cm }))
    },
    onSuccess: () => {
      if (!preview) void qc.invalidateQueries({ queryKey: bodyKeys.target })
    },
  })
}
