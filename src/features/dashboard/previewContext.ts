import { createContext, useContext } from 'react'

/** True inside the dev-only Home preview: dashboard queries read seeded cache data and never hit the network. */
export const DashboardPreviewContext = createContext(false)
export const useIsDashboardPreview = () => useContext(DashboardPreviewContext)
