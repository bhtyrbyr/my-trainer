import { describe, expect, it } from 'vitest'
import { matchSummary } from './exercisedbLogic'

describe('matchSummary', () => {
  it('totals matched and unmatched rows and orders the segments', () => {
    const s = matchSummary({ exact: 300, fuzzy: 120, ai: 40, manual: 0, unmatched: 140 })
    expect(s.total).toBe(600)
    expect(s.matched).toBe(460)
    expect(s.unmatched).toBe(140)
    expect(s.coverage).toBeCloseTo(460 / 600)
    expect(s.segments.map((x) => x.kind)).toEqual(['exact', 'fuzzy', 'ai', 'unmatched'])
    expect(s.segments.reduce((a, x) => a + x.ratio, 0)).toBeCloseTo(1)
  })

  it('treats missing or invalid counts as zero', () => {
    const s = matchSummary({ exact: 5, fuzzy: -3, ai: Number.NaN })
    expect(s).toMatchObject({ total: 5, matched: 5, unmatched: 0, coverage: 1 })
    expect(s.segments).toEqual([{ kind: 'exact', count: 5, ratio: 1 }])
  })

  it('handles an empty catalog', () => {
    expect(matchSummary(undefined)).toEqual({ total: 0, matched: 0, unmatched: 0, coverage: 0, segments: [] })
  })
})
