import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dehydrate, hydrate, onlineManager, QueryClient } from '@tanstack/react-query'
import type { PersistedClient } from '@tanstack/react-query-persist-client'

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1' } } } })) } },
}))

import { supabase } from '@/lib/supabase'
import {
  assertOwner,
  cancelQueuedInsert,
  discardQueued,
  failedQueued,
  failureKind,
  isDuplicate,
  newId,
  queuedKey,
  queuedMutations,
  registerQueued,
  retryDelay,
  retryQueued,
  shouldRetry,
  type QueuedVars,
} from './queue'
import { dehydrateOptions, isPersistableKey } from './policy'
import { plainError, reviveClient, serializeClient } from './persister'

type V = QueuedVars & { id: string; n: number }
const ADD = queuedKey('test', 'add')
const DEL = queuedKey('test', 'del')
const noCheck = async () => undefined
const vars = (n: number): V => ({ id: `id-${n}`, n, userId: 'u1', at: '2026-10-31T10:00:00.000Z' })
const flush = () => new Promise((r) => setTimeout(r, 0))

/** A fake table: inserts by client id, like the real api functions (duplicate id = already done). */
function fakeServer() {
  const rows = new Map<string, number>()
  const log: string[] = []
  return {
    rows,
    log,
    async insert(v: V) {
      log.push(`start:${v.n}`)
      await new Promise((r) => setTimeout(r, 5))
      if (!rows.has(v.id)) rows.set(v.id, v.n)
      log.push(`end:${v.n}`)
      return v.n
    },
  }
}

function enqueue(qc: QueryClient, key: readonly unknown[], v: V) {
  return qc.getMutationCache().build(qc, { mutationKey: key }).execute(v).catch(() => undefined)
}

let qc: QueryClient

beforeEach(() => {
  qc = new QueryClient()
  qc.mount()
  onlineManager.setOnline(true)
})
afterEach(() => {
  qc.unmount()
  onlineManager.setOnline(true)
})

describe('failure policy', () => {
  it('classifies network, transient and final errors', () => {
    expect(failureKind(new TypeError('Failed to fetch'))).toBe('network')
    expect(failureKind({ message: 'TypeError: Load failed', code: '' })).toBe('network')
    expect(failureKind({ message: 'JWT expired', code: 'PGRST301' })).toBe('transient')
    expect(failureKind(new Error('NOT_AUTHENTICATED'))).toBe('transient')
    expect(failureKind({ message: 'new row violates check constraint', code: '23514' })).toBe('final')
    expect(failureKind({ message: 'FUTURE_DATE', code: 'P0001' })).toBe('final')
  })

  it('retries the network forever, transient errors a few times, final errors never', () => {
    expect(shouldRetry(50, new TypeError('Failed to fetch'))).toBe(true)
    expect(shouldRetry(0, { message: 'x', code: '57014' })).toBe(true)
    expect(shouldRetry(5, { message: 'x', code: '57014' })).toBe(false)
    expect(shouldRetry(0, { message: 'x', code: '42501' })).toBe(false)
    expect(retryDelay(0)).toBe(1000)
    expect(retryDelay(3)).toBe(8000)
    expect(retryDelay(20)).toBe(30_000)
  })

  it('recognises a duplicate primary key', () => {
    expect(isDuplicate({ code: '23505', message: 'duplicate key' })).toBe(true)
    expect(isDuplicate({ code: '23514' })).toBe(false)
    expect(isDuplicate(null)).toBe(false)
  })

  it('makes v4 uuids', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(newId()).not.toBe(newId())
  })
})

describe('owner check', () => {
  it('replays only for the account that queued the write', async () => {
    await expect(assertOwner('u1')).resolves.toBeUndefined()
    await expect(assertOwner('u2')).rejects.toThrow('QUEUE_OWNER_MISMATCH')
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({ data: { session: null }, error: null } as never)
    await expect(assertOwner('u1')).rejects.toThrow('NOT_AUTHENTICATED')
  })
})

describe('queue ordering', () => {
  it('pauses offline and replays strictly one after another, in submission order, on reconnect', async () => {
    const server = fakeServer()
    registerQueued<number, V>(qc, ADD, { mutationFn: server.insert }, noCheck)
    onlineManager.setOnline(false)
    const done = [3, 1, 2].map((n) => enqueue(qc, ADD, vars(n)))
    await flush()
    expect(server.log).toEqual([])
    expect(queuedMutations(qc).every((m) => m.state.isPaused)).toBe(true)

    onlineManager.setOnline(true)
    await Promise.all(done)
    expect(server.log).toEqual(['start:3', 'end:3', 'start:1', 'end:1', 'start:2', 'end:2'])
  })

  it('survives a reload: persisted, restored into a fresh client, replayed in order once', async () => {
    const server = fakeServer()
    registerQueued<number, V>(qc, ADD, { mutationFn: server.insert }, noCheck)
    onlineManager.setOnline(false)
    for (const n of [1, 2, 3]) void enqueue(qc, ADD, vars(n))
    await flush()

    const persisted: PersistedClient = serializeClient({ timestamp: Date.now(), buster: '', clientState: dehydrate(qc, dehydrateOptions) })
    expect(persisted.clientState.mutations).toHaveLength(3)

    // "reload": the old page is gone; a new client registers its defaults, then hydrates the persisted state
    qc.unmount()
    qc.getMutationCache().clear()
    const qc2 = new QueryClient()
    qc2.mount()
    registerQueued<number, V>(qc2, ADD, { mutationFn: server.insert }, noCheck)
    hydrate(qc2, reviveClient(structuredClone(persisted), true).clientState)
    onlineManager.setOnline(true)
    await qc2.resumePausedMutations()
    await flush()
    expect(server.log.filter((l) => l.startsWith('start'))).toEqual(['start:1', 'start:2', 'start:3'])
    expect([...server.rows.values()]).toEqual([1, 2, 3])
    qc2.unmount()
  })

  it('a replay of a write whose answer was lost is harmless (client id)', async () => {
    const server = fakeServer()
    let calls = 0
    registerQueued<number, V>(
      qc,
      ADD,
      {
        mutationFn: async (v) => {
          calls++
          await server.insert(v)
          if (calls === 1) throw new TypeError('Failed to fetch') // reached the server, answer lost
          return v.n
        },
      },
      noCheck,
    )
    vi.useFakeTimers()
    try {
      const p = enqueue(qc, ADD, vars(7))
      await vi.runAllTimersAsync()
      await p
    } finally {
      vi.useRealTimers()
    }
    expect(calls).toBe(2)
    expect(server.rows.size).toBe(1)
  })

  it('a final error does not block the writes behind it; retry runs it again with the same id', async () => {
    const server = fakeServer()
    let reject = true
    registerQueued<number, V>(
      qc,
      ADD,
      {
        mutationFn: async (v) => {
          if (v.n === 1 && reject) throw { message: 'violates check constraint', code: '23514' }
          return server.insert(v)
        },
      },
      noCheck,
    )
    await Promise.all([enqueue(qc, ADD, vars(1)), enqueue(qc, ADD, vars(2))])
    expect([...server.rows.keys()]).toEqual(['id-2'])
    const [failed] = failedQueued(qc)
    expect(failed.state.variables).toMatchObject({ id: 'id-1' })

    reject = false
    retryQueued(qc, failed)
    await flush()
    await new Promise((r) => setTimeout(r, 20))
    expect([...server.rows.keys()]).toEqual(['id-2', 'id-1'])
    expect(failedQueued(qc)).toHaveLength(0)
  })

  it('discard drops a failed write and refetches what it touched', async () => {
    registerQueued<number, V>(qc, ADD, { mutationFn: async () => Promise.reject({ message: 'no', code: '42501' }), invalidates: [['things']] }, noCheck)
    const spy = vi.spyOn(qc, 'invalidateQueries')
    await enqueue(qc, ADD, vars(1))
    discardQueued(qc, failedQueued(qc)[0])
    expect(queuedMutations(qc)).toHaveLength(0)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['things'] })
  })
})

describe('cancelQueuedInsert', () => {
  it('drops an insert that never left the device, instead of queueing its delete', async () => {
    const server = fakeServer()
    registerQueued<number, V>(qc, ADD, { mutationFn: server.insert }, noCheck)
    registerQueued<number, V>(qc, DEL, { mutationFn: async (v) => v.n }, noCheck)
    onlineManager.setOnline(false)
    void enqueue(qc, ADD, vars(1))
    void enqueue(qc, ADD, vars(2))
    await flush()
    expect(cancelQueuedInsert(qc, ADD, 'id-1')).toBe(true)
    expect(cancelQueuedInsert(qc, ADD, 'id-404')).toBe(false)
    onlineManager.setOnline(true)
    await new Promise((r) => setTimeout(r, 30))
    expect([...server.rows.keys()]).toEqual(['id-2'])
  })

  it('keeps an insert that may already be on the server', async () => {
    let release: () => void = () => undefined
    registerQueued<number, V>(qc, ADD, { mutationFn: (v) => new Promise<number>((r) => (release = () => r(v.n))) }, noCheck)
    const p = enqueue(qc, ADD, vars(1))
    await flush()
    expect(cancelQueuedInsert(qc, ADD, 'id-1')).toBe(false) // in flight
    release()
    await p
  })
})

describe('persistence policy', () => {
  it('never persists photos, signed URLs, admin, consents, push or AI state', () => {
    expect(isPersistableKey(['workouts', 'session', 'x'])).toBe(true)
    expect(isPersistableKey(['today', 'logs', '2026-07-01', '2026-10-31'])).toBe(true)
    expect(isPersistableKey(['sleepwater', 'water', '2026-10-31'])).toBe(true)
    expect(isPersistableKey(['photos', 'vault'])).toBe(false)
    expect(isPersistableKey(['photos', 'list'])).toBe(false)
    expect(isPersistableKey(['exercise-media', 'a/b.gif'])).toBe(false)
    expect(isPersistableKey(['admin', 'ai', 'usage', 7])).toBe(false)
    expect(isPersistableKey(['consents'])).toBe(false)
    expect(isPersistableKey(['push', 'device'])).toBe(false)
    expect(isPersistableKey(['nutrition', 'ai-availability'])).toBe(false)
    expect(isPersistableKey(['ai-coach', 'conversations'])).toBe(false)
  })

  it('persists only successful queries and only queued writes that still matter', async () => {
    registerQueued<number, V>(qc, ADD, { mutationFn: async () => Promise.reject({ message: 'no', code: '42501' }) }, noCheck)
    qc.setQueryData(['workouts', 'templates'], [1])
    qc.setQueryData(['photos', 'list'], [{ id: 'p' }])
    await enqueue(qc, ADD, vars(1)) // failed: kept for retry / discard
    await qc.getMutationCache().build(qc, { mutationFn: async () => 1 }).execute(undefined) // not queued
    const state = dehydrate(qc, dehydrateOptions)
    expect(state.queries.map((q) => q.queryKey)).toEqual([['workouts', 'templates']])
    expect(state.mutations).toHaveLength(1)
  })
})

describe('persister serialization', () => {
  it('keeps the fields classifyError reads and revives in-flight writes as paused', () => {
    expect(plainError({ message: 'dup', code: '23505', details: 'Key (id)', extra: () => 1 })).toEqual({
      name: 'Error',
      message: 'dup',
      code: '23505',
      details: 'Key (id)',
      hint: undefined,
      status: undefined,
    })
    expect(plainError(null)).toBeNull()

    const client: PersistedClient = {
      timestamp: 1,
      buster: '',
      clientState: {
        queries: [{ queryKey: ['workouts'], queryHash: '["workouts"]', state: {} as never, dehydratedAt: 1 }],
        mutations: [
          { mutationKey: ADD, state: { status: 'pending', isPaused: false, error: null, failureReason: new TypeError('Failed to fetch') } as never },
          { mutationKey: ADD, state: { status: 'error', isPaused: false, error: { message: 'x', code: '23514' }, failureReason: null } as never },
        ],
      },
    }
    const stored = serializeClient(client)
    expect(stored.clientState.mutations[0].state.failureReason).toMatchObject({ name: 'TypeError', message: 'Failed to fetch' })
    const revived = reviveClient(stored, true)
    expect(revived.clientState.mutations[0].state.isPaused).toBe(true)
    expect(revived.clientState.mutations[1].state.isPaused).toBe(false)
    expect(revived.clientState.queries).toHaveLength(1)
    // after an app update cached reads are dropped, queued writes stay
    expect(reviveClient(stored, false).clientState.queries).toHaveLength(0)
    expect(reviveClient(stored, false).clientState.mutations).toHaveLength(2)
  })
})
