import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import type { RegistrationStatus } from '@/lib/database.types'
import { aiAppToday, aiLive, aiModelLimits, aiUsage, deleteRejectedUser, listErrorReports, listRegistrations, pendingCount, setAiModelLimits, setErrorReportStatus, setRegistrationStatus } from './api'
import { parseLimits, type ModelLimits } from './aiUsageLogic'
import { useIsAdminPreview } from './previewContext'

export function useDeleteRejectedUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => deleteRejectedUser(userId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['admin'] })
    },
  })
}

export const adminKeys = {
  registrations: (status: string) => ['admin', 'registrations', status] as const,
  pendingCount: ['admin', 'pendingCount'] as const,
  aiUsage: (days: number) => ['admin', 'ai', 'usage', days] as const,
  aiLive: ['admin', 'ai', 'live'] as const,
  aiApp: ['admin', 'ai', 'app'] as const,
  aiLimits: ['admin', 'ai', 'limits'] as const,
  reports: (status: string) => ['admin', 'reports', status] as const,
}

export function useIsAdmin() {
  const { profile } = useAuth()
  const preview = useIsAdminPreview()
  return profile?.role === 'admin' && !preview
}

export function usePendingCount() {
  const isAdmin = useIsAdmin()
  return useQuery({
    queryKey: adminKeys.pendingCount,
    queryFn: pendingCount,
    enabled: isAdmin,
    refetchInterval: 60_000,
  })
}

export function useRegistrations(status: RegistrationStatus | 'all') {
  const isAdmin = useIsAdmin()
  return useQuery({
    queryKey: adminKeys.registrations(status),
    queryFn: () => listRegistrations(status),
    enabled: isAdmin,
  })
}

export function useSetRegistrationStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: RegistrationStatus }) => setRegistrationStatus(userId, status),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['admin'] })
    },
  })
}

export function useAiUsage(days: number) {
  const isAdmin = useIsAdmin()
  return useQuery({ queryKey: adminKeys.aiUsage(days), queryFn: () => aiUsage(days), enabled: isAdmin, staleTime: 60_000 })
}

/** Today per model + the last minute (RPM/TPM); refreshed every 30 s while the page is open. */
export function useAiLive() {
  const isAdmin = useIsAdmin()
  return useQuery({ queryKey: adminKeys.aiLive, queryFn: aiLive, enabled: isAdmin, refetchInterval: 30_000 })
}

export function useAiAppToday() {
  const isAdmin = useIsAdmin()
  return useQuery({ queryKey: adminKeys.aiApp, queryFn: aiAppToday, enabled: isAdmin, refetchInterval: 60_000 })
}

export function useAiModelLimits() {
  const isAdmin = useIsAdmin()
  return useQuery({ queryKey: adminKeys.aiLimits, queryFn: async () => parseLimits(await aiModelLimits()), enabled: isAdmin })
}

export function useSetAiModelLimits() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (limits: ModelLimits) => setAiModelLimits(limits),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.aiLimits })
    },
  })
}

export function useErrorReports(status: 'open' | 'resolved' | 'all') {
  const isAdmin = useIsAdmin()
  return useQuery({ queryKey: adminKeys.reports(status), queryFn: () => listErrorReports(status), enabled: isAdmin, refetchInterval: 120_000 })
}

export function useSetErrorReportStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'open' | 'resolved' }) => setErrorReportStatus(id, status),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'reports'] })
    },
  })
}
