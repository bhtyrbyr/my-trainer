import { useMutation, useMutationState, useQuery, useQueryClient, type Mutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { nutritionKeys } from '@/features/nutrition'
import { saveTemplate, workoutKeys, type TemplateInput } from '@/features/workouts'
import { useUserSettings } from '@/features/settings/hooks'
import { asWeightUnit } from '@/lib/units'
import * as api from './api'
import { COACH_ANSWERED, programTemplateName, titleFrom } from './logic'
import { useCoachPreview } from './previewContext'
import type { CoachMessage, CoachProgram, CoachProgramDay, CoachProgramReply, CoachReply, Conversation } from './schema'

export const coachKeys = {
  all: ['coach'] as const,
  conversations: ['coach', 'conversations'] as const,
  messages: (id: string) => ['coach', 'messages', id] as const,
  reply: ['coach', 'reply'] as const,
  /** Program cards by assistant message id: memory only (the stored message is the summary text). */
  program: (messageId: string) => ['coach', 'program', messageId] as const,
}

export function useConversations() {
  const preview = useCoachPreview()
  return useQuery({ queryKey: coachKeys.conversations, queryFn: api.listConversations, enabled: !preview, staleTime: 30_000 })
}

export function useMessages(conversationId: string | null) {
  const preview = useCoachPreview()
  return useQuery({
    queryKey: coachKeys.messages(conversationId ?? 'none'),
    queryFn: () => api.listMessages(conversationId!),
    enabled: !preview && conversationId !== null,
    staleTime: 30_000,
  })
}

const append = (m: CoachMessage) => (prev: CoachMessage[] = []) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m])

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let previewSeq = 0

/** Starts a conversation when needed (titled by the question) and stores the user's message. */
export function useAsk() {
  const qc = useQueryClient()
  const preview = useCoachPreview()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async ({
      conversationId,
      text,
    }: {
      conversationId: string | null
      text: string
    }): Promise<{ conversationId: string; message: CoachMessage; created: Conversation | null }> => {
      if (preview) {
        await sleep(150)
        const now = new Date().toISOString()
        const id = conversationId ?? `preview-${++previewSeq}`
        return {
          conversationId: id,
          message: { id: `${id}-u${++previewSeq}`, role: 'user', content: text, created_at: now },
          created: conversationId ? null : { id, title: titleFrom(text), created_at: now, updated_at: now },
        }
      }
      if (!user) throw new Error('NOT_AUTHENTICATED')
      const created = conversationId ? null : await api.createConversation(user.id, titleFrom(text))
      const id = conversationId ?? created!.id
      try {
        return { conversationId: id, message: await api.addUserMessage(user.id, id, text), created }
      } catch (e) {
        // e.g. the daily message limit: do not leave an empty conversation behind
        if (created) await api.deleteConversation(created.id).catch(() => undefined)
        throw e
      }
    },
    onSuccess: ({ conversationId, message, created }) => {
      qc.setQueryData(coachKeys.messages(conversationId), append(message))
      // the chat opens on the new id right away; it must already be in the list
      if (created) qc.setQueryData<Conversation[]>(coachKeys.conversations, (prev = []) => [created, ...prev.filter((c) => c.id !== created.id)])
      if (!preview) void qc.invalidateQueries({ queryKey: coachKeys.conversations })
    },
  })
}

type ReplyVars = { conversationId: string; request?: string }

/**
 * Asks the Edge Function to answer. Keyed so any screen can tell a reply is on its way for a
 * conversation (the typing state survives leaving and reopening the chat).
 */
export function useReply() {
  const qc = useQueryClient()
  const preview = useCoachPreview()
  const { i18n } = useTranslation()
  const { settings } = useUserSettings()
  const unit = asWeightUnit(settings?.unit_weight)
  return useMutation({
    mutationKey: coachKeys.reply,
    mutationFn: async ({ conversationId }: ReplyVars): Promise<CoachReply> => {
      if (preview) {
        await sleep(preview.delayMs)
        if (preview.fail) throw new Error(preview.fail)
        return {
          message: { id: `${conversationId}-a${++previewSeq}`, role: 'assistant', content: preview.reply, created_at: new Date().toISOString() },
          remaining: 36,
        }
      }
      return api.requestReply({ conversationId, locale: i18n.resolvedLanguage === 'en' ? 'en' : 'tr', unit })
    },
    onSuccess: (r, { conversationId }) => {
      qc.setQueryData(coachKeys.messages(conversationId), append(r.message))
    },
    onSettled: (_r, error, { conversationId }) => {
      if (preview) return
      void qc.invalidateQueries({ queryKey: coachKeys.conversations })
      void qc.invalidateQueries({ queryKey: nutritionKeys.ai }) // the AI quota is shared with the food estimate
      if (error) void qc.invalidateQueries({ queryKey: coachKeys.messages(conversationId) })
      // consent withdrawn on another device: show the consent card again
      if (error && /AI_CONSENT_REQUIRED/.test(error.message)) void qc.invalidateQueries({ queryKey: ['consents'] })
    },
  })
}

/** The newest reply request for a conversation: pending (typing), failed (error note) or done. */
export function useReplyState(conversationId: string | null) {
  const states = useMutationState({
    filters: {
      mutationKey: coachKeys.reply,
      predicate: (m: Mutation<unknown, Error, unknown>) => (m.state.variables as ReplyVars | undefined)?.conversationId === conversationId,
    },
    select: (m) => ({ status: m.state.status, error: m.state.error as Error | null, at: m.state.submittedAt }),
  })
  const last = states.length ? states.reduce((a, b) => (b.at >= a.at ? b : a)) : null
  return {
    pending: states.some((s) => s.status === 'pending'),
    // a double tap that found the answer already stored is not an error
    error: last?.status === 'error' && last.error?.message !== COACH_ANSWERED ? last.error : null,
  }
}

export function useDeleteConversation() {
  const qc = useQueryClient()
  const preview = useCoachPreview()
  return useMutation({
    mutationFn: async (id: string) => {
      if (!preview) await api.deleteConversation(id)
    },
    onSuccess: (_r, id) => {
      qc.setQueryData<Conversation[]>(coachKeys.conversations, (prev = []) => prev.filter((c) => c.id !== id))
      qc.removeQueries({ queryKey: coachKeys.messages(id) })
    },
  })
}

/**
 * Asks the Edge Function for a program (same mutation key as a reply, so the typing and error states
 * are shared). The card data is kept in the query cache for this session only; it is cleared with the
 * cache on sign-out and never persisted on the device.
 */
export function useProgram() {
  const qc = useQueryClient()
  const preview = useCoachPreview()
  const { i18n } = useTranslation()
  return useMutation({
    mutationKey: coachKeys.reply,
    mutationFn: async ({ conversationId, request = '' }: ReplyVars): Promise<CoachProgramReply> => {
      if (preview) {
        await sleep(preview.delayMs)
        if (preview.fail || !preview.program) throw new Error(preview.fail ?? 'COACH_AI_UNAVAILABLE')
        return {
          ...preview.program,
          message: { id: `${conversationId}-a${++previewSeq}`, role: 'assistant', content: preview.reply, created_at: new Date().toISOString() },
          remaining: 35,
        }
      }
      return api.requestProgram({ conversationId, locale: i18n.resolvedLanguage === 'en' ? 'en' : 'tr', request })
    },
    onSuccess: (r, { conversationId }) => {
      qc.setQueryDefaults(['coach', 'program'], { staleTime: Infinity, gcTime: Infinity })
      if (r.program.days.length) qc.setQueryData(coachKeys.program(r.message.id), { program: r.program, unmatched: r.unmatched })
      qc.setQueryData(coachKeys.messages(conversationId), append(r.message))
    },
    onSettled: (_r, error, { conversationId }) => {
      if (preview) return
      void qc.invalidateQueries({ queryKey: coachKeys.conversations })
      void qc.invalidateQueries({ queryKey: nutritionKeys.ai })
      if (error) void qc.invalidateQueries({ queryKey: coachKeys.messages(conversationId) })
      if (error && /AI_CONSENT_REQUIRED/.test(error.message)) void qc.invalidateQueries({ queryKey: ['consents'] })
    },
  })
}

export type ProgramCardData = { program: CoachProgram; unmatched: string[] }

/** The program card for an assistant message, if this session received one. */
export function useProgramFor(messageId: string) {
  return useQuery<ProgramCardData | null>({
    queryKey: coachKeys.program(messageId),
    queryFn: () => Promise.resolve(null),
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  }).data
}

/** Program day -> template input: no weekdays, one fixed rep target, the suggested rest. */
export function dayTemplate(program: CoachProgram, day: CoachProgramDay): TemplateInput {
  return {
    name: programTemplateName(program.name, day.name),
    weekdays: [],
    exercises: day.exercises.map((e) => ({
      id: crypto.randomUUID(),
      exercise_id: e.exercise_id,
      target_sets: e.sets,
      target_reps_low: e.reps,
      target_reps_high: e.reps,
      rest_seconds: e.rest_sec,
    })),
  }
}

/** Saves program days as new templates, one by one (RLS-scoped inserts with the caller's id). */
export function useSaveProgramDays() {
  const qc = useQueryClient()
  const preview = useCoachPreview()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async ({ program, days }: { program: CoachProgram; days: number[] }): Promise<number[]> => {
      if (preview) {
        await sleep(400)
        return days
      }
      if (!user) throw new Error('NOT_AUTHENTICATED')
      const saved: number[] = []
      for (const i of days) {
        const day = program.days[i]
        if (!day) continue
        await saveTemplate(user.id, null, dayTemplate(program, day))
        saved.push(i)
      }
      return saved
    },
    onSettled: () => {
      if (!preview) void qc.invalidateQueries({ queryKey: workoutKeys.all })
    },
  })
}
