import { createContext, useContext } from 'react'

/** True inside the dev-only preview routes: hooks read seeded cache data and never hit the network. */
export const SleepWaterPreviewContext = createContext(false)
export const useIsSleepWaterPreview = () => useContext(SleepWaterPreviewContext)
