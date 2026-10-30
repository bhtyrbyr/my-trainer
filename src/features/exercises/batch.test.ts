import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBatcher } from './batch'

describe('createBatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('merges lookups of one tick into a single call with unique keys', async () => {
    const run = vi.fn(async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, `signed:${k}`])))
    const get = createBatcher(run, 10)
    const all = Promise.all([get('a'), get('b'), get('a')])
    await vi.advanceTimersByTimeAsync(10)
    expect(await all).toEqual(['signed:a', 'signed:b', 'signed:a'])
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(['a', 'b'])
  })

  it('starts a new batch after a flush and resolves missing keys to null', async () => {
    const run = vi.fn(async (keys: string[]): Promise<Record<string, string>> => (keys.includes('x') ? { x: 'X' } : {}))
    const get = createBatcher(run, 10)
    const first = get('x')
    await vi.advanceTimersByTimeAsync(10)
    const second = get('missing')
    await vi.advanceTimersByTimeAsync(10)
    expect(await first).toBe('X')
    expect(await second).toBeNull()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('rejects every caller of a failed batch', async () => {
    const get = createBatcher(async () => {
      throw new Error('boom')
    }, 10)
    const a = get('a')
    const b = get('b')
    const settled = Promise.allSettled([a, b])
    await vi.advanceTimersByTimeAsync(10)
    expect((await settled).map((r) => r.status)).toEqual(['rejected', 'rejected'])
  })
})
