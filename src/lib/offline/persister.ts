import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client'

/**
 * IndexedDB persister for the TanStack Query cache and the offline write queue.
 *
 * One record per device, tagged with its owner (user id): a different account never restores it.
 * Writes are throttled (the cache changes on every fetch) and flushed when the page is hidden.
 * `clearPersistedCache()` (sign-out, account switch) deletes the record and invalidates every
 * persister created before it, so a late write from the previous session can never resurrect data.
 * What is persisted at all is decided by policy.ts (never photos, signed URLs, admin, consents, AI).
 */
const DB_NAME = 'mt-query-cache'
const STORE = 'clients'
const RECORD = 'current'

export type StoredClient = { owner: string; version: string; client: PersistedClient }

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }).catch((e) => {
      dbPromise = null
      throw e
    })
  }
  return dbPromise
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE)) // put() throws DataCloneError synchronously: rejects this promise
    t.oncomplete = () => resolve(req.result as T)
    t.onerror = () => reject(t.error ?? req.error)
    t.onabort = () => reject(t.error ?? req.error)
  })
}

/** Storage blocked (private mode), full or missing: the app keeps working, it just will not survive a reload. */
async function safely<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (typeof indexedDB === 'undefined') return undefined
  try {
    return await fn()
  } catch (e) {
    console.warn('[offline] storage unavailable', e)
    return undefined
  }
}

const readRecord = () => safely(() => tx<StoredClient | undefined>('readonly', (s) => s.get(RECORD)))
const deleteRecord = () => safely(() => tx<undefined>('readwrite', (s) => s.delete(RECORD)))

async function writeRecord(value: StoredClient): Promise<void> {
  await safely(async () => {
    try {
      await tx('readwrite', (s) => s.put(value, RECORD))
    } catch (e) {
      if ((e as { name?: string })?.name !== 'DataCloneError') throw e
      // a non-cloneable value slipped into the cache: store a JSON copy rather than losing the queue
      await tx('readwrite', (s) => s.put(JSON.parse(JSON.stringify(value)), RECORD))
    }
  })
}

// -----------------------------------------------------------------------------
// (De)serialization: pure, unit-tested
// -----------------------------------------------------------------------------
type PlainError = { name: string; message: string; code?: string; details?: string; hint?: string; status?: number }

/** Errors lose their own fields in structured clone; keep what classifyError() reads. */
export function plainError(e: unknown): PlainError | null {
  if (e == null) return null
  if (typeof e !== 'object') return { name: 'Error', message: String(e) }
  const o = e as Record<string, unknown>
  const pick = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : undefined)
  return {
    name: pick('name') ?? 'Error',
    message: pick('message') ?? String(e),
    code: pick('code'),
    details: pick('details'),
    hint: pick('hint'),
    status: typeof o.status === 'number' ? o.status : undefined,
  }
}

export function serializeClient(client: PersistedClient): PersistedClient {
  const mutations = client.clientState.mutations.map((m) => ({
    ...m,
    state: { ...m.state, error: plainError(m.state.error), failureReason: plainError(m.state.failureReason) },
  }))
  return { ...client, clientState: { ...client.clientState, mutations } }
}

/**
 * Restore: a write that was on the wire when the app died is marked paused so it replays (its client id
 * makes the replay harmless). After an app update (`sameVersion` false) cached reads are dropped, queued
 * writes are kept.
 */
export function reviveClient(client: PersistedClient, sameVersion: boolean): PersistedClient {
  const mutations = client.clientState.mutations.map((m) => (m.state.status === 'pending' ? { ...m, state: { ...m.state, isPaused: true } } : m))
  return { ...client, clientState: { ...client.clientState, queries: sameVersion ? client.clientState.queries : [], mutations } }
}

// -----------------------------------------------------------------------------
// Generation: bumped by clearPersistedCache, observed by the persistence gate
// -----------------------------------------------------------------------------
let generation = 0
const listeners = new Set<() => void>()

export const persistGeneration = {
  get: () => generation,
  subscribe(cb: () => void) {
    listeners.add(cb)
    return () => void listeners.delete(cb)
  },
}

/** Forget the persisted cache and queue (sign-out / another account). Pending writes of older persisters are dropped. */
export async function clearPersistedCache(): Promise<void> {
  generation++
  listeners.forEach((l) => l())
  await deleteRecord()
}

export type IdbPersister = Persister & { flush: () => Promise<void> }

export function createIdbPersister(owner: string, version: string, throttleMs = 1000): IdbPersister {
  const gen = generation
  const alive = () => gen === generation
  let latest: PersistedClient | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const write = async () => {
    timer = null
    const client = latest
    latest = null
    if (!client || !alive()) return
    await writeRecord({ owner, version, client: serializeClient(client) })
  }

  return {
    persistClient(client) {
      if (!alive()) return
      latest = client
      if (!timer) timer = setTimeout(() => void write(), throttleMs)
    },
    async restoreClient() {
      const stored = await readRecord()
      if (!stored) return undefined
      if (stored.owner !== owner) {
        await deleteRecord()
        return undefined
      }
      return reviveClient(stored.client, stored.version === version)
    },
    async removeClient() {
      if (alive()) await deleteRecord()
    },
    async flush() {
      if (!timer) return
      clearTimeout(timer)
      await write()
    },
  }
}
