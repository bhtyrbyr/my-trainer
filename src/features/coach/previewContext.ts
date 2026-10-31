import { createContext, useContext } from 'react'
import type { CoachProgramReply } from './schema'

/**
 * Dev-only preview: queries read seeded cache data, sending appends locally and the coach "answers"
 * with a canned reply after `delayMs` (or fails with `fail`). Nothing reaches Supabase or a model.
 */
export type CoachPreview = { reply: string; delayMs: number; fail?: string; base: string; program?: Omit<CoachProgramReply, 'message' | 'remaining'> }
export const CoachPreviewContext = createContext<CoachPreview | null>(null)
export const useCoachPreview = () => useContext(CoachPreviewContext)
/** Route prefix for in-app links ('' in the app, '/__dev' in the preview). */
export const useCoachBase = () => useContext(CoachPreviewContext)?.base ?? ''
