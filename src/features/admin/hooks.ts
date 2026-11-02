import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import type { RegistrationStatus } from '@/lib/database.types'
import {
  addAllowedEmail,
  aiAppToday,
  aiLive,
  aiModelLimits,
  aiUsage,
  deleteRejectedUser,
  exerciseDbMatchCounts,
  fetchAdminConfig,
  listAllowedEmails,
  listErrorReports,
  listRegistrations,
  listMatchRows,
  listUsers,
  pendingCount,
  removeAllowedEmail,
  searchExerciseDb,
  setAdminConfig,
  setAiModelLimits,
  setErrorReportStatus,
  setExerciseMedia,
  setRegistrationStatus,
  setUserAiLimit,
  setUserBlocked,
  usageSummary,
  type AdminUser,
  type MatchList,
  type MatchRow,
} from './api'
import type { AdminConfig, AdminConfigKey } from './adminLogic'
import { parseLimits, type ModelLimits } from './aiUsageLogic'
import { applyMatchChange, isSearchable, matchKindOf, withoutRow, type ExerciseDbHit, type InfiniteList, type MatchCounts } from './exercisedbLogic'
import { exerciseKeys, type Exercise } from '@/features/exercises'
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
  exercisedbList: (list: MatchList, query: string) => ['admin', 'exercisedb', 'list', list, query] as const,
  exercisedbUnmatched: (query: string) => ['admin', 'exercisedb', 'list', 'unmatched', query] as const,
  exercisedbCounts: ['admin', 'exercisedb', 'counts'] as const,
  exercisedbSearch: (q: string) => ['admin', 'exercisedb', 'search', q] as const,
  /** dev preview only: the sample hits every search returns there */
  exercisedbSearchSample: ['admin', 'exercisedb', 'search-sample'] as const,
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

/** A worklist of the ExerciseDB page (unmatched A-Z, or AI matches newest first), a page at a time ("load more"). */
export function useMatchRows(list: MatchList, query: string) {
  const isAdmin = useIsAdmin()
  return useInfiniteQuery({
    queryKey: adminKeys.exercisedbList(list, query),
    queryFn: ({ pageParam }) => listMatchRows(list, query, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (all.reduce((n, p) => n + p.rows.length, 0) < last.total && last.rows.length > 0 ? all.length : undefined),
    enabled: isAdmin,
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
  })
}

/** Admin (or the admin dev preview): may pick an exercise's ExerciseDB animation by hand. */
export function useCanEditExerciseMedia() {
  const isAdmin = useIsAdmin()
  const preview = useIsAdminPreview()
  return isAdmin || preview
}

/**
 * ExerciseDB hits for a search term (2..60 chars) via the Edge Function. Never persisted (admin root).
 * In the dev preview every term answers with the seeded sample hits, without a request.
 */
export function useExerciseDbSearch(q: string) {
  const isAdmin = useIsAdmin()
  const preview = useIsAdminPreview()
  const qc = useQueryClient()
  const term = q.trim()
  return useQuery({
    queryKey: adminKeys.exercisedbSearch(term.toLocaleLowerCase('en')),
    queryFn: async (): Promise<ExerciseDbHit[]> =>
      preview ? (qc.getQueryData<ExerciseDbHit[]>(adminKeys.exercisedbSearchSample) ?? []) : searchExerciseDb(term),
    enabled: (isAdmin || preview) && isSearchable(term),
    placeholderData: (prev) => prev,
    staleTime: 10 * 60_000,
    retry: 1,
  })
}

type MediaTarget = Pick<Exercise, 'id' | 'exercisedb_id'> & { exercisedb_match?: string | null }

/**
 * Set (id) or remove (null) the ExerciseDB animation of a catalog exercise. On success the cached exercise,
 * the match counts and the worklists change at once (the row leaves the lists it no longer belongs to);
 * then exercise lists and the admin page refetch. In the dev preview only the cache changes.
 */
export function useSetExerciseMedia() {
  const qc = useQueryClient()
  const preview = useIsAdminPreview()
  return useMutation({
    mutationFn: async ({ exercise, exercisedbId }: { exercise: MediaTarget; exercisedbId: string | null }) => {
      if (!preview) await setExerciseMedia(exercise.id, exercisedbId)
    },
    onSuccess: (_d, { exercise, exercisedbId }) => {
      const from = matchKindOf(exercise)
      const to = exercisedbId ? 'manual' : 'unmatched'
      const match = exercisedbId ? ('manual' as const) : null
      qc.setQueryData<Exercise | null>(exerciseKeys.one(exercise.id), (ex) => (ex ? { ...ex, exercisedb_id: exercisedbId, exercisedb_match: match } : ex))
      qc.setQueryData<MatchCounts>(adminKeys.exercisedbCounts, (c) => (c ? applyMatchChange(c, from, to) : c))
      type ListData = InfiniteList<MatchRow>
      if (to !== 'unmatched') qc.setQueriesData<ListData>({ queryKey: ['admin', 'exercisedb', 'list', 'unmatched'] }, (d) => withoutRow(d, exercise.id))
      qc.setQueriesData<ListData>({ queryKey: ['admin', 'exercisedb', 'list', 'ai'] }, (d) => withoutRow(d, exercise.id))
    },
    onSettled: () => {
      if (preview) return
      // every cached exercise row (search lists, by id, by ids), not the user's progress
      void qc.invalidateQueries({ queryKey: exerciseKeys.all, predicate: (q) => q.queryKey[1] !== 'progress' })
      void qc.invalidateQueries({ queryKey: ['admin', 'exercisedb'] })
    },
  })
}

/** Catalog rows per match kind (exact / fuzzy / ai / manual / unmatched). */
export function useExerciseDbMatchCounts() {
  const isAdmin = useIsAdmin()
  return useQuery({ queryKey: adminKeys.exercisedbCounts, queryFn: exerciseDbMatchCounts, enabled: isAdmin, staleTime: 5 * 60_000 })
}
