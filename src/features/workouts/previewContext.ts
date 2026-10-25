import { createContext, useContext } from 'react'

/**
 * Dev-only design previews (/__dev/workouts/...) render the real screens against a pre-seeded query cache.
 * When this flag is on, every mutation resolves locally and nothing is written to (or refetched from) Supabase.
 */
export const WorkoutsPreviewContext = createContext(false)

export function useIsPreview(): boolean {
  return useContext(WorkoutsPreviewContext)
}
