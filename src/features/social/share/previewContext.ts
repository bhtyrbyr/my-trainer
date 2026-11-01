import { createContext, useContext } from 'react'
import type { AudienceChoice, MentionCandidate } from './types'

/**
 * Dev-only previews (/__dev/share) render the real share UI with sample data. When set, mutations resolve
 * locally, social counts as enabled and media paths resolve to the supplied sample URLs.
 */
export type SharePreview = {
  meId: string
  resolveMedia: (path: string) => string | null
  groups: { id: string; name: string }[]
  /** sample people for the mention picker; `allowed` mimics the server's audience rule */
  people?: (MentionCandidate & { allowed: (t: AudienceChoice) => boolean })[]
}
export const SharePreviewContext = createContext<SharePreview | null>(null)

export function useSharePreview(): SharePreview | null {
  return useContext(SharePreviewContext)
}
