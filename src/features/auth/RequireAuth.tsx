import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth, type AuthStatus } from './AuthProvider'
import { routeFor } from './routeFor'
import { FullScreenSpinner } from '@/components/layout/FullScreenSpinner'

function Gate({ allow, children }: { allow: AuthStatus[]; children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading' || status === 'checking') return <FullScreenSpinner />
  if (allow.includes(status)) return <>{children}</>
  const to = routeFor(status) ?? '/'
  return <Navigate to={to} replace state={status === 'signed-out' ? { from: location } : undefined} />
}

/** Main app: signed in, onboarded, approved, not blocked. */
export function RequireAuth({ children }: { children: ReactNode }) {
  return <Gate allow={['ready']}>{children}</Gate>
}

/** /onboarding: signed in and NOT yet onboarded. */
export function RequireOnboarding({ children }: { children?: ReactNode }) {
  // Without children it acts as a layout route so the onboarding page itself can be lazy-loaded.
  return <Gate allow={['onboarding']}>{children ?? <Outlet />}</Gate>
}

/** /pending: onboarded but waiting for (or refused) admin approval. */
export function RequirePending({ children }: { children: ReactNode }) {
  return <Gate allow={['pending', 'rejected']}>{children}</Gate>
}

/** Admin-only screens (on top of RequireAuth). */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  if (profile?.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}
