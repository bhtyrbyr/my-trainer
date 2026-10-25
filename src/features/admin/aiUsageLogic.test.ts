import { describe, expect, it } from 'vitest'
import { dailySeries, dayIn, nextMidnight, parseLimits, todayByModel, tzOffsetMinutes, type UsageRow } from './aiUsageLogic'

const row = (day_pt: string, model: string, requests: number, total_tokens: number, who = 'Ali'): UsageRow => ({
  day_pt,
  user_id: 'u',
  username: who.toLowerCase(),
  display_name: who,
  action: 'food_estimate_text',
  model,
  requests,
  failed: 0,
  prompt_tokens: 0,
  output_tokens: 0,
  total_tokens,
})

describe('Pacific quota day', () => {
  it('knows the Pacific date and offset', () => {
    // 2026-10-26 07:30 UTC is still Oct 26 00:30 in Los Angeles (PDT, -7h)
    const d = new Date('2026-10-26T07:30:00Z')
    expect(dayIn('America/Los_Angeles', d)).toBe('2026-10-26')
    expect(tzOffsetMinutes('America/Los_Angeles', d)).toBe(-420)
    expect(dayIn('America/Los_Angeles', new Date('2026-10-26T06:30:00Z'))).toBe('2026-10-25')
  })
  it('finds the next Pacific midnight, also across the DST switch', () => {
    expect(nextMidnight('America/Los_Angeles', new Date('2026-10-26T12:00:00Z')).toISOString()).toBe('2026-10-27T07:00:00.000Z')
    // PDT ends 2026-11-01: midnight of Nov 2 is 08:00 UTC (PST, -8h)
    expect(nextMidnight('America/Los_Angeles', new Date('2026-11-01T20:00:00Z')).toISOString()).toBe('2026-11-02T08:00:00.000Z')
  })
})

describe('series and totals', () => {
  const now = new Date('2026-10-26T20:00:00Z') // Pacific day 2026-10-26
  const rows = [row('2026-10-26', 'gemini-3.8-flash', 3, 900), row('2026-10-26', 'gemini-3.8-flash', 1, 100, 'Ayşe'), row('2026-10-24', 'gemini-3.5-flash-lite', 2, 400)]
  it('fills missing days and sums per day and user', () => {
    const s = dailySeries(rows, 3, now)
    expect(s.map((x) => x.day)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26'])
    expect(s[2]).toMatchObject({ requests: 4, tokens: 1000, users: { Ali: 900, Ayşe: 100 } })
    expect(s[1].requests).toBe(0)
  })
  it('totals today per model', () => {
    expect(todayByModel(rows, now)).toEqual({ 'gemini-3.8-flash': { requests: 4, tokens: 1000 } })
  })
  it('sanitizes limits', () => {
    expect(parseLimits({ m: { rpm: 10, tpm: -1, rpd: '5' } })).toEqual({ m: { rpm: 10, tpm: 0, rpd: 0 } })
    expect(parseLimits(null)).toEqual({})
  })
})
