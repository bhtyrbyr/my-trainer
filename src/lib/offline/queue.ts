import type { Mutation, MutationKey, QueryClient, QueryKey } from '@tanstack/react-query'
import { classifyError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

/**
 * Offline write queue (Faz 4 section 6).
 *
 * Gym-critical writes are TanStack mutations with a key under ['offline', feature, op] and defaults
 * registered once per QueryClient (`registerQueued`). Every queued mutation shares one scope, so
 * TanStack runs them strictly one after another in submission order; while the device is offline they
 * pause, are persisted to IndexedDB with the query cache (see persister.ts) and replay on reconnect or on
 * the next app start. Screens never wait for them: read hooks overlay the queued variables on the cached
 * rows (each feature's offline.ts), so the UI is optimistic and survives reloads.
 *
 * Idempotence: inserts carry a client-generated uuid, so a replay whose first attempt reached the server
 * hits the primary key (23505) and is treated as done; absolute writes (habit count) are upserts; deletes
 * by id are naturally idempotent. Points are written by DB triggers keyed by the row, never twice.
 */
export const QUEUE_ROOT = 'offline'
export const QUEUE_SCOPE = 'mt-offline-queue'

/** Every queued variable carries its owner (checked before replay) and the moment it was queued. */
export type QueuedVars = { userId: string; at: string }

export function queuedKey<F extends string, O extends string>(feature: F, op: O) {
  return [QUEUE_ROOT, feature, op] as const
}

type KeyHolder = { options: { mutationKey?: MutationKey } }
type AnyMutation = Mutation<unknown, unknown, unknown, unknown>

export function isQueuedMutation(m: KeyHolder): boolean {
  return m.options.mutationKey?.[0] === QUEUE_ROOT
}

// -----------------------------------------------------------------------------
// Ids and timestamps
// -----------------------------------------------------------------------------
/** RFC 4122 v4 uuid. crypto.randomUUID needs a secure context; the LAN dev server (http) has only getRandomValues. */
export function newId(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  c.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const nowISO = () => new Date().toISOString()

// -----------------------------------------------------------------------------
// Failure policy
// -----------------------------------------------------------------------------
/**
 * network: no connection (or a dead one): keep retrying, forever, the queue just waits.
 * transient: the server or the session is not ready (expired JWT before refresh, deploy, 5xx): a few retries.
 * final: the server said no (validation, RLS, guard). Surfaced to the user with retry / discard.
 */
export type FailureKind = 'network' | 'transient' | 'final'

const NETWORK_MESSAGE = /Failed to fetch|NetworkError|Load failed|FetchError|fetch failed|Network request failed|AbortError|TimeoutError/i
const TRANSIENT_KEYS = new Set(['errors.sessionExpired', 'errors.timeout', 'errors.updating', 'errors.server', 'errors.rateLimited'])

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err && 'message' in err) return String((err as { message: unknown }).message)
  return typeof err === 'string' ? err : ''
}

export function failureKind(err: unknown): FailureKind {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code ?? '') : ''
  if (!code && NETWORK_MESSAGE.test(messageOf(err))) return 'network'
  const { key } = classifyError(err)
  if (key === 'errors.offline' || key === 'errors.network') return 'network'
  return TRANSIENT_KEYS.has(key) ? 'transient' : 'final'
}

export const MAX_TRANSIENT_RETRIES = 5

export function shouldRetry(failureCount: number, err: unknown): boolean {
  const kind = failureKind(err)
  return kind === 'network' || (kind === 'transient' && failureCount < MAX_TRANSIENT_RETRIES)
}

/** 1 s, 2 s, 4 s ... capped at 30 s. */
export function retryDelay(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt))
}

/** Postgres unique violation: the row (with our client id) is already there. */
export function isDuplicate(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505'
}

// -----------------------------------------------------------------------------
// Owner check
// -----------------------------------------------------------------------------
/**
 * A queued write replays only for the account that queued it. Sign-out and account switches clear the
 * queue (clearUserData), this is the second line of defence. The row's user_id is still checked by RLS.
 */
export async function assertOwner(userId: string): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const current = data.session?.user.id
  if (!current) throw new Error('NOT_AUTHENTICATED')
  if (current !== userId) throw new Error('QUEUE_OWNER_MISMATCH')
}

// -----------------------------------------------------------------------------
// Registration
// -----------------------------------------------------------------------------
export type QueueMeta = {
  /** query prefixes refreshed once the whole queue has drained */
  invalidates?: QueryKey[]
  /** the write moves points: refresh profile, leaderboard, dashboard and badges after the drain */
  points?: boolean
}

type QueuedDefinition<TData, TVars> = {
  mutationFn: (vars: TVars) => Promise<TData>
  /** patch caches with the server's answer (runs for replays after a reload too) */
  onSuccess?: (data: TData, vars: TVars) => void
} & QueueMeta

/**
 * Register the defaults of one queued write. Hook-level `useMutation({ mutationKey })` must not pass
 * onMutate/onSuccess/onError (they would replace these); per-call callbacks go to `mutate(vars, opts)`.
 */
export function registerQueued<TData, TVars extends QueuedVars>(
  qc: QueryClient,
  key: MutationKey,
  { mutationFn, onSuccess, invalidates = [], points = false }: QueuedDefinition<TData, TVars>,
  check: (userId: string) => Promise<void> = assertOwner,
): void {
  qc.setMutationDefaults<TData, Error, TVars>(key, {
    mutationFn: async (vars) => {
      await check(vars.userId)
      return mutationFn(vars)
    },
    onSuccess: onSuccess ? (data, vars) => onSuccess(data, vars) : undefined,
    scope: { id: QUEUE_SCOPE },
    networkMode: 'online',
    retry: shouldRetry,
    retryDelay,
    // failed writes stay until the user retries or discards them; successes are pruned by the drain watcher
    gcTime: Infinity,
    meta: { invalidates, points } satisfies QueueMeta,
  })
}

// -----------------------------------------------------------------------------
// Inspecting and steering the queue
// -----------------------------------------------------------------------------
export type QueuedOp<V = unknown> = {
  mutationId: number
  op: string
  vars: V
  status: 'pending' | 'error'
}

export function queuedMutations(qc: QueryClient): AnyMutation[] {
  return qc.getMutationCache().getAll().filter(isQueuedMutation) as AnyMutation[]
}

export function failedQueued(qc: QueryClient): AnyMutation[] {
  return queuedMutations(qc).filter((m) => m.state.status === 'error')
}

/** Run a failed write again (with the same variables, so with the same client id). */
export function retryQueued(qc: QueryClient, m: AnyMutation): void {
  const cache = qc.getMutationCache()
  const vars = m.state.variables
  const mutationKey = m.options.mutationKey
  cache.remove(m)
  void cache
    .build(qc, { mutationKey })
    .execute(vars)
    .catch(() => undefined)
}

/** Drop a failed write; the affected screens refetch the server's truth. */
export function discardQueued(qc: QueryClient, m: AnyMutation): void {
  qc.getMutationCache().remove(m)
  const meta = (m.options.meta ?? {}) as QueueMeta
  for (const queryKey of meta.invalidates ?? []) void qc.invalidateQueries({ queryKey })
}

/**
 * Undo a queued insert that never reached the server (still waiting, or rejected for good), instead of
 * queueing its delete: an add + delete pair that cancels out locally never touches the backend.
 * Returns false when the insert may already be on the server; the caller then queues the delete.
 */
export function cancelQueuedInsert(qc: QueryClient, key: MutationKey, id: string): boolean {
  const m = queuedMutations(qc).find(
    (x) => sameKey(x.options.mutationKey, key) && (x.state.variables as { id?: unknown } | undefined)?.id === id,
  )
  if (!m) return false
  const neverSent = m.state.status === 'pending' && m.state.isPaused && m.state.failureCount === 0
  const rejected = m.state.status === 'error' && failureKind(m.state.error) === 'final'
  if (!neverSent && !rejected) return false
  qc.getMutationCache().remove(m)
  return true
}

function sameKey(a: MutationKey | undefined, b: MutationKey): boolean {
  return Boolean(a) && a!.length === b.length && a!.every((x, i) => x === b[i])
}
