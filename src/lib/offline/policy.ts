import { defaultShouldDehydrateQuery, type DehydrateOptions, type Mutation, type Query, type QueryKey } from '@tanstack/react-query'
import { isQueuedMutation } from './queue'

/**
 * What may be written to IndexedDB. The user's own rows (workouts, habits, health logs) may persist;
 * these never do:
 *  - photos: vault, list, metadata, decrypted data (CLAUDE.md rule 5: plaintext never touches IndexedDB)
 *  - exercise-media: short-lived signed URLs
 *  - admin: other users' data, must be fresh
 *  - consents: legal state, must be fresh
 *  - push: this browser's subscription state
 *  - anything AI (availability, coach): quota/consent gated, must be fresh
 * A query can also opt out with `meta: { persist: false }`.
 */
const DENY_ROOTS = new Set(['photos', 'exercise-media', 'admin', 'consents', 'push', 'offline'])
const AI_SEGMENT = /^ai($|[-_])|coach/i
const SECRET_SEGMENT = /vault|signed|media|decrypt|private-key|privateKey/i

export function isPersistableKey(key: QueryKey): boolean {
  const [root] = key
  if (typeof root !== 'string' || DENY_ROOTS.has(root)) return false
  return !key.some((seg) => typeof seg === 'string' && (AI_SEGMENT.test(seg) || SECRET_SEGMENT.test(seg)))
}

type QueryLike = Pick<Query, 'queryKey' | 'meta' | 'state'>

export function shouldPersistQuery(q: QueryLike): boolean {
  return defaultShouldDehydrateQuery(q as Query) && q.meta?.persist !== false && isPersistableKey(q.queryKey)
}

/** Only queued writes that still matter: waiting (to replay) or failed (to retry / discard). */
export function shouldPersistMutation(m: Pick<Mutation, 'options' | 'state'>): boolean {
  return isQueuedMutation(m) && (m.state.status === 'pending' || m.state.status === 'error')
}

export const dehydrateOptions: DehydrateOptions = {
  shouldDehydrateQuery: shouldPersistQuery,
  shouldDehydrateMutation: shouldPersistMutation,
}
