import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import type { RegistrationStatus } from '@/lib/database.types'
import {
  addAllowedEmail,
  aiAppToday,
  aiLive,
  aiModelLimits,
  aiUsage,
  deleteRejectedUser,
  fetchAdminConfig,
  listAllowedEmails,
  listErrorReports,
  listRegistrations,
  listUsers,
  pendingCount,
  removeAllowedEmail,
  setAdminConfig,
  setAiModelLimits,
  setErrorReportStatus,
  setRegistrationStatus,
  setUserAiLimit,
  setUserBlocked,
  usageSummary,
  type AdminUser,
} from './api'
import type { AdminConfig, AdminConfigKey } from './adminLogic'
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
  config: ['admin', 'config'] as const,
  allowed: ['admin', 'allowed'] as const,
  users: (query: string) => ['admin', 'users', query] as const,
  usage: ['admin', 'usage'] as const,
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

// ---------------------------------------------------------------------------------------------
// Access and users. In the dev preview (AdminPreviewContext) mutations only edit the seeded cache.

export function useAdminConfig() {
  const isAdmin = useIsAdmin()
  return useQuery({ queryKey: adminKeys.config, queryFn: fetchAdminConfig, enabled: isAdmin, staleTime: 60_000 })
}

/** Optimistic: the switch moves at once and rolls back on error. */
export function useSetAdminConfig() {
  const qc = useQueryClient()
  const preview = useIsAdminPreview()
  return useMutation({
    mutationFn: async ({ key, value }: { key: AdminConfigKey; value: AdminConfig[AdminConfigKey] }) => {
      if (!preview) await setAdminConfig(key, value)
    },
    onMutate: async ({ key, value }) => {
      await qc.cancelQueries({ queryKey: adminKeys.config })
      const prev = qc.getQueryData<AdminConfig>(adminKeys.config)
      if (prev) qc.setQueryData<AdminConfig>(adminKeys.config, { ...prev, [key]: value })
      const prevApp = qc.getQueryData<{ used: number; limit: number }>(adminKeys.aiApp)
      if (key === 'ai_global_daily_limit' && prevApp) qc.setQueryData(adminKeys.aiApp, { ...prevApp, limit: value as number })
      return { prev, prevApp }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(adminKeys.config, ctx.prev)
      if (ctx?.prevApp) qc.setQueryData(adminKeys.aiApp, ctx.prevApp)
    },
    onSettled: () => {
      if (preview) return
      void qc.invalidateQueries({ queryKey: adminKeys.config })
      void qc.invalidateQueries({ queryKey: adminKeys.aiApp })
    },
  })
}

export function useAllowedEmails() {
  const isAdmin = useIsAdmin()
  return useQuery({ queryKey: adminKeys.allowed, queryFn: listAllowedEmails, enabled: isAdmin })
}

type AllowedRow = Awaited<ReturnType<typeof listAllowedEmails>>[number]

export function useAddAllowedEmail() {
  const qc = useQueryClient()
  const preview = useIsAdminPreview()
  return useMutation({
    mutationFn: async ({ email, note }: { email: string; note: string | null }) => {
      if (!preview) return addAllowedEmail(email, note)
      qc.setQueryData<AllowedRow[]>(adminKeys.allowed, (rows = []) => [
        { email, note: note ?? '', added_by: 'preview', added_by_username: 'preview', created_at: new Date().toISOString() },
        ...rows.filter((r) => r.email !== email),
      ])
    },
    onSettled: () => {
      if (!preview) void qc.invalidateQueries({ queryKey: adminKeys.allowed })
    },
  })
}

export function useRemoveAllowedEmail() {
  const qc = useQueryClient()
  const preview = useIsAdminPreview()
  return useMutation({
    mutationFn: async (email: string) => {
      if (!preview) return removeAllowedEmail(email)
      qc.setQueryData<AllowedRow[]>(adminKeys.allowed, (rows = []) => rows.filter((r) => r.email !== email))
      return true
    },
    onSettled: () => {
      if (!preview) void qc.invalidateQueries({ queryKey: adminKeys.allowed })
    },
  })
}

export function useAdminUsers(query: string) {
  const isAdmin = useIsAdmin()
  return useQuery({
    queryKey: adminKeys.users(query),
    queryFn: () => listUsers(query),
    enabled: isAdmin,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  })
}

/** Patch one user in every cached search result (preview, and the instant feedback before refetch). */
function patchUser(qc: ReturnType<typeof useQueryClient>, userId: string, patch: Partial<AdminUser>) {
  qc.setQueriesData<AdminUser[]>({ queryKey: ['admin', 'users'] }, (rows) => rows?.map((r) => (r.user_id === userId ? { ...r, ...patch } : r)))
}

export function useSetUserBlocked() {
  const qc = useQueryClient()
  const preview = useIsAdminPreview()
  return useMutation({
    mutationFn: async ({ userId, blocked }: { userId: string; blocked: boolean }) => {
      if (!preview) await setUserBlocked(userId, blocked)
    },
    onSuccess: (_d, { userId, blocked }) => patchUser(qc, userId, { is_blocked: blocked }),
    onSettled: () => {
      if (!preview) void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

export function useSetUserAiLimit() {
  const qc = useQueryClient()
  const preview = useIsAdminPreview()
  return useMutation({
    mutationFn: async ({ userId, limit }: { userId: string; limit: number }) => {
      if (!preview) await setUserAiLimit(userId, limit)
    },
    onSuccess: (_d, { userId, limit }) => patchUser(qc, userId, { ai_daily_limit: limit }),
    onSettled: () => {
      if (!preview) void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

export function useUsageSummary() {
  const isAdmin = useIsAdmin()
  return useQuery({ queryKey: adminKeys.usage, queryFn: usageSummary, enabled: isAdmin, staleTime: 5 * 60_000 })
}
