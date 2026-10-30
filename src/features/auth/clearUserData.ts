import type { QueryClient } from '@tanstack/react-query'
import { forgetAllVaultKeys } from '@/features/photos/keyStore'
import { clearPersistedCache } from '@/lib/offline/persister'

const LAST_USER_KEY = 'mt.lastUserId'
const USER_SCOPED_PREFIXES = ['mt.workout.draft.']
/** Service-worker runtime caches that may hold per-user API responses (see vite.config.ts). */
const USER_SCOPED_CACHES = ['supabase-rest']

/**
 * Remove everything that belongs to the previous user on this device: in-memory query cache and
 * offline write queue, their IndexedDB copy, per-user localStorage keys and the service worker's REST
 * cache. Called on sign-out and whenever a different account signs in on the same device.
 * Writes still waiting in the offline queue are dropped with the rest (they belong to that account).
 */
export async function clearUserData(qc: QueryClient): Promise<void> {
  qc.clear() // queries and mutations (the offline queue)
  await clearPersistedCache()
  // photo vault keys remembered on this device belong to the previous user
  await forgetAllVaultKeys()
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key && USER_SCOPED_PREFIXES.some((p) => key.startsWith(p))) localStorage.removeItem(key)
    }
  } catch {
    /* storage unavailable (private mode): nothing persisted anyway */
  }
  try {
    if ('caches' in window) await Promise.all(USER_SCOPED_CACHES.map((name) => caches.delete(name)))
  } catch {
    /* Cache API unavailable */
  }
}

/** True when `userId` differs from the last account seen on this device (and remembers it). */
export function isDifferentUser(userId: string): boolean {
  try {
    const last = localStorage.getItem(LAST_USER_KEY)
    localStorage.setItem(LAST_USER_KEY, userId)
    return last !== null && last !== userId
  } catch {
    return false
  }
}

export function forgetLastUser(): void {
  try {
    localStorage.removeItem(LAST_USER_KEY)
  } catch {
    /* ignore */
  }
}
