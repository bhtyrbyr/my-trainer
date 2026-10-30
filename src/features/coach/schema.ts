import { z } from 'zod'

export const conversationSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type Conversation = z.infer<typeof conversationSchema>

export const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  created_at: z.string(),
})
export type CoachMessage = z.infer<typeof messageSchema>

/** ai-coach `coach-chat` answer. */
export const replySchema = z.object({
  message: messageSchema,
  remaining: z.number().nullable().optional(),
})
export type CoachReply = z.infer<typeof replySchema>
