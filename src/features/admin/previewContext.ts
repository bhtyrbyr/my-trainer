import { createContext, useContext } from 'react'

/** True inside the dev-only preview route: admin queries read seeded cache data and never hit the network. */
export const AdminPreviewContext = createContext(false)
export const useIsAdminPreview = () => useContext(AdminPreviewContext)
