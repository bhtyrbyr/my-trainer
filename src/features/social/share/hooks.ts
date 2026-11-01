import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { enUS, tr } from 'date-fns/locale'
import { useAuth } from '@/features/auth/AuthProvider'
import { saveTemplate } from '@/features/workouts/api'
import * as api from './api'
import { programExerciseIds, programToTemplates } from './payload'
import { useSharePreview } from './previewContext'
import type { AudienceChoice, ProgramPayload } from './types'

export const shareKeys = {
  all: ['share'] as const,
  enabled: ['share', 'enabled'] as const,
  groups: ['share', 'groups'] as const,
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Posts live in the core social feature's caches (['social', ...]); refresh those after a change. */
function useRefreshFeeds() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['social'] })
}

export function useSocialEnabled(): { enabled: boolean; loading: boolean } {
  const preview = useSharePreview()
  const { user } = useAuth()
  const q = useQuery({
    queryKey: shareKeys.enabled,
    queryFn: api.isSocialEnabled,
    enabled: !preview && Boolean(user),
    staleTime: 60_000,
    meta: { persist: false },
  })
  if (preview) return { enabled: true, loading: false }
  return { enabled: q.data === true, loading: q.isLoading }
}

export function useMyGroups(enabled: boolean) {
  const preview = useSharePreview()
  const q = useQuery({ queryKey: shareKeys.groups, queryFn: api.myGroups, enabled: enabled && !preview, staleTime: 60_000, meta: { persist: false } })
  return preview ? { data: preview.groups, isLoading: false } : q
}

export function usePublishPost() {
  const preview = useSharePreview()
  const { user } = useAuth()
  const refresh = useRefreshFeeds()
  return useMutation({
    mutationFn: async (p: api.NewPost) => {
      if (preview) {
        await sleep(500)
        return 'preview'
      }
      if (!user) throw new Error('NOT_AUTHENTICATED')
      return api.publishPost(user.id, p)
    },
    onSuccess: () => void refresh(),
  })
}

export function useDeletePost() {
  const preview = useSharePreview()
  const refresh = useRefreshFeeds()
  return useMutation({
    mutationFn: (postId: string) => (preview ? sleep(300) : api.deletePost(postId)),
    onSuccess: () => void refresh(),
  })
}

export function useSetAudience() {
  const preview = useSharePreview()
  const refresh = useRefreshFeeds()
  return useMutation({
    mutationFn: ({ postId, target }: { postId: string; target: AudienceChoice }) => (preview ? sleep(300) : api.setAudience(postId, target)),
    onSuccess: () => void refresh(),
  })
}

export function useLike() {
  const preview = useSharePreview()
  return useMutation({
    mutationFn: async ({ postId, like, count }: { postId: string; like: boolean; count: number }) =>
      preview ? count : api.setLike(postId, like),
  })
}

export function useReportPost() {
  const preview = useSharePreview()
  return useMutation({
    mutationFn: ({ postId, reason }: { postId: string; reason: string }) => (preview ? sleep(300) : api.reportPost(postId, reason)),
  })
}

/** Copies a shared program into the viewer's templates (catalog exercises only). Returns the skipped names. */
export function useCopyProgram() {
  const preview = useSharePreview()
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (program: ProgramPayload): Promise<{ created: number; skipped: string[] }> => {
      const ids = programExerciseIds(program)
      const known = preview ? new Set(ids) : await api.catalogExerciseIds(ids)
      const copy = programToTemplates(program, known, () => crypto.randomUUID())
      if (preview) {
        await sleep(400)
        return { created: copy.templates.length, skipped: copy.skipped }
      }
      if (!user) throw new Error('NOT_AUTHENTICATED')
      for (const tpl of copy.templates) await saveTemplate(user.id, null, tpl)
      return { created: copy.templates.length, skipped: copy.skipped }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['workouts'] }),
  })
}

export function useDateFnsLocale() {
  const { i18n } = useTranslation()
  return i18n.resolvedLanguage === 'en' ? enUS : tr
}
