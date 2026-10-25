import type { AuthStatus } from './AuthProvider'

/** Where each non-ready auth status must live. Shared by all gates and auth pages so redirects never loop. */
export function routeFor(status: AuthStatus): string | null {
  switch (status) {
    case 'signed-out':
      return '/login'
    case 'blocked':
      return '/denied'
    case 'onboarding':
      return '/onboarding'
    case 'pending':
    case 'rejected':
      return '/pending'
    default:
      return null
  }
}
