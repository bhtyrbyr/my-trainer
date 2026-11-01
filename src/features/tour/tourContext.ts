import { createContext, useContext } from 'react'

/** Lets Settings > About reopen the tour. Outside TourGate (dev previews) it does nothing. */
export const TourContext = createContext<{ open: () => void }>({ open: () => {} })

export const useTour = () => useContext(TourContext)
