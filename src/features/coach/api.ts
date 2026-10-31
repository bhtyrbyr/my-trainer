import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { coachErrorCode } from './logic'
import {
  conversationSchema,
  messageSchema,
  programReplySchema,
  replySchema,
  type CoachMessage,
  type CoachProgramReply,
  type CoachReply,
  type Conversation,
} from './schema'

/** The trigger's LIMIT_REACHED means different things per table; give each its own code. */
function retag(error: { message?: string }, code: string): never {
  if (/LIMIT_REACHED/.test(error.message ?? '')) throw new Error(code)
  throw error
}

/** The caller's conversations, newest activity first (RLS: owner only). */
export async function listConversations(): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('ai_conversations')
    .select('id, title, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return conversationSchema.array().parse(data ?? [])
}

export async function listMessages(conversationId: string): Promise<CoachMessage[]> {
  const { data, error } = await supabase
    .from('ai_messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(400)
  if (error) throw error
  return messageSchema.array().parse(data ?? [])
}

export async function createConversation(userId: string, title: string): Promise<Conversation> {
  const { data, error } = await supabase
    .from('ai_conversations')
    .insert({ user_id: userId, title })
    .select('id, title, created_at, updated_at')
    .single()
  if (error) retag(error, 'COACH_CONVERSATION_LIMIT')
  return conversationSchema.parse(data)
}

/** Only 'user' messages can be inserted from the browser; replies come from the Edge Function. */
export async function addUserMessage(userId: string, conversationId: string, content: string): Promise<CoachMessage> {
  const { data, error } = await supabase
    .from('ai_messages')
    .insert({ user_id: userId, conversation_id: conversationId, role: 'user', content })
    .select('id, role, content, created_at')
    .single()
  if (error) retag(error, 'COACH_MESSAGE_LIMIT')
  return messageSchema.parse(data)
}

export async function deleteConversation(id: string): Promise<void> {
  const { error } = await supabase.from('ai_conversations').delete().eq('id', id)
  if (error) throw error
}

/**
 * Ask the ai-coach Edge Function to answer the newest message. The browser never talks to the model
 * providers; the function reads the conversation and the context with this user's token.
 */
export async function requestReply(input: { conversationId: string; locale: 'tr' | 'en'; unit: 'kg' | 'lb' }): Promise<CoachReply> {
  return replySchema.parse(
    await invokeCoach({ action: 'coach-chat', conversation_id: input.conversationId, locale: input.locale, unit: input.unit }),
  )
}

/**
 * Ask for a workout program for the newest (user) message. The function matches the exercises to the
 * catalog and stores a readable summary as the reply; the structured program is only in the answer.
 */
export async function requestProgram(input: { conversationId: string; locale: 'tr' | 'en'; request: string }): Promise<CoachProgramReply> {
  return programReplySchema.parse(
    await invokeCoach({ action: 'coach-program', conversation_id: input.conversationId, locale: input.locale, request: input.request || undefined }),
  )
}

async function invokeCoach(body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('ai-coach', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response
      const payload = await res.json().catch(() => null)
      throw new Error(coachErrorCode(res.status, typeof payload?.error === 'string' ? payload.error : 'AI_UNAVAILABLE'))
    }
    throw error
  }
  return data
}

