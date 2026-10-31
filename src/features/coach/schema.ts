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

export const programExerciseSchema = z.object({
  exercise_id: z.string(),
  name_en: z.string(),
  name_tr: z.string().nullable(),
  sets: z.number().int(),
  reps: z.number().int(),
  rest_sec: z.number().int(),
})
export const programSchema = z.object({
  name: z.string(),
  notes: z.string().nullable(),
  days: z.array(z.object({ name: z.string(), exercises: z.array(programExerciseSchema) })),
})
export type CoachProgram = z.infer<typeof programSchema>
export type CoachProgramDay = CoachProgram['days'][number]

/** ai-coach `coach-program` answer: the stored summary message plus the structured program. */
export const programReplySchema = replySchema.extend({
  program: programSchema,
  unmatched: z.array(z.string()),
})
export type CoachProgramReply = z.infer<typeof programReplySchema>
