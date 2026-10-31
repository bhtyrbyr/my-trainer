import { describe, expect, it } from 'vitest'
import { FREE_TIER, formatBytes, parseUsageSummary, usageMeters } from './usageLogic'

describe('usage summary', () => {
  it('parses the RPC result, sums buckets and estimates edge calls', () => {
    const s = parseUsageSummary({ db_bytes: 52428800, storage: { avatars: 1000, 'exercise-media': '3000' }, users_total: 4, users_active_7d: 3, ai_calls_month: 120, push_month: 30 })
    expect(s).toMatchObject({ dbBytes: 52428800, storageBytes: 4000, usersTotal: 4, usersActive7d: 3, edgeCallsMonth: 150 })
    expect(usageMeters(s).map((m) => [m.key, m.ratio])).toEqual([
      ['db', 0.1],
      ['storage', 4000 / FREE_TIER.storageBytes],
      ['edge', 150 / FREE_TIER.edgeCallsMonth],
    ])
  })

  it('tolerates a missing or odd payload and caps the ratio at 1', () => {
    expect(parseUsageSummary(null).storageBytes).toBe(0)
    expect(usageMeters({ ...parseUsageSummary(null), dbBytes: FREE_TIER.dbBytes * 2 })[0].ratio).toBe(1)
  })

  it('formats sizes', () => {
    expect(formatBytes(8.4 * 1024 ** 2, 'en')).toBe('8.4 MB')
    expect(formatBytes(312 * 1024 ** 2, 'en')).toBe('312 MB')
    expect(formatBytes(1024 ** 3, 'en')).toBe('1 GB')
    expect(formatBytes(512, 'en')).toBe('512 B')
  })
})
