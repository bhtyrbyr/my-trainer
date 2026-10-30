import { describe, expect, it, vi } from 'vitest'
import type { QueuedOp } from '@/lib/offline/queue'
import { createFakeSupabase } from '@/test/fakeSupabase'

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeSupabase> | null }))
vi.mock('@/lib/supabase', async () => {
  const { createFakeSupabase } = await import('@/test/fakeSupabase')
  fake.current = createFakeSupabase()
  return { supabase: fake.current.client }
})

import * as api from './api'
import { applyWaterOps, type WaterVars } from './offline'
import type { WaterEntry } from './types'

const at = '2026-10-31T10:00:00.000Z'
const op = (o: string, vars: object): QueuedOp<WaterVars> => ({ mutationId: 0, op: o, vars: { userId: 'u1', at, ...vars } as WaterVars, status: 'pending' })
const row = (id: string, ml: number): WaterEntry => ({ id, user_id: 'u1', drunk_on: '2026-10-31', amount_ml: ml, logged_at: at, created_at: at })

describe('applyWaterOps', () => {
  it("adds and removes the day's queued drinks in order", () => {
    const out = applyWaterOps([row('w1', 250)], '2026-10-31', [
      op('addWater', { id: 'w2', day: '2026-10-31', ml: 500 }),
      op('addWater', { id: 'w3', day: '2026-10-31', ml: 200 }),
      op('deleteWater', { id: 'w1', day: '2026-10-31' }),
      op('addWater', { id: 'w4', day: '2026-10-30', ml: 200 }),
    ])!
    expect(out.map((r) => [r.id, r.amount_ml])).toEqual([
      ['w2', 500],
      ['w3', 200],
    ])
    expect(out[0].logged_at).toBe(at) // the time of the tap, not of the sync
  })

  it('works before the day was ever loaded, and does not double a synced drink', () => {
    expect(applyWaterOps(undefined, '2026-10-31', [op('addWater', { id: 'w2', day: '2026-10-31', ml: 500 })])).toHaveLength(1)
    expect(applyWaterOps([row('w1', 250)], '2026-10-31', [op('addWater', { id: 'w1', day: '2026-10-31', ml: 250 })])).toHaveLength(1)
  })
})

describe('idempotent water writes', () => {
  it('a replayed insert returns the stored drink instead of counting it twice', async () => {
    const w = { id: 'c-1', day: '2026-10-31', ml: 250, loggedAt: at }
    const first = await api.addWater('u1', w)
    expect(await api.addWater('u1', w)).toEqual(first)
    expect(fake.current!.table('water_entries')).toHaveLength(1)
  })
})
