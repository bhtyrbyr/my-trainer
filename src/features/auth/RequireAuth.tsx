import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { FullScreenSpinner } from '@/components/layout/FullScreenSpinner'

/** Gate for the main app: must be signed in, not blocked, and onboarded. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading' || status === 'checking') return <FullScreenSpinner />
  if (status === 'signed-out') return <Navigate to="/login" replace state={{ from: location }} />
  if (status === 'blocked') return <Navigate to="/denied" replace />
  if (status === 'onboarding') return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

/** Gate for /onboarding: must be signed in and NOT yet onboarded. */
export function RequireOnboarding({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  if (status === 'loading' || status === 'checking') return <FullScreenSpinner />
  if (status === 'signed-out') return <Navigate to="/login" replace />
  if (status === 'blocked') return <Navigate to="/denied" replace />
  if (status === 'ready') return <Navigate to="/" replace />
  return <>{children}</>
}
