import { createContext, useContext } from 'react'

/** True inside dev-only previews: badge queries read seeded cache data and never hit the network. */
export const BadgesPreviewContext = createContext(false)
export const useIsBadgesPreview = () => useContext(BadgesPreviewContext)
