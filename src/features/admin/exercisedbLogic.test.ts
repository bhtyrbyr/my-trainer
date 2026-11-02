import { describe, expect, it } from 'vitest'
import {
  applyMatchChange,
  isSearchable,
  matchKindOf,
  matchSummary,
  parseSearchResults,
  simplifyExerciseName,
  withoutRow,
  type MatchCounts,
} from './exercisedbLogic'

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

describe('simplifyExerciseName', () => {
  it('cuts qualifiers after with / on / a dash / a comma and drops parentheses', () => {
    expect(simplifyExerciseName('band pull-apart with external rotation')).toBe('band pull-apart')
    expect(simplifyExerciseName('Dead Bug with Band')).toBe('dead bug')
    expect(simplifyExerciseName('Push-up on knees')).toBe('push-up')
    expect(simplifyExerciseName('Bench Press - Narrow Grip')).toBe('bench press')
    expect(simplifyExerciseName('Squat, front (version 2)')).toBe('squat')
    expect(simplifyExerciseName('Curl (EZ bar)')).toBe('curl')
  })
  it('keeps the last four words, where the movement is', () => {
    expect(simplifyExerciseName('single arm dumbbell bent over row')).toBe('dumbbell bent over row')
    expect(simplifyExerciseName('alternating kettlebell floor press')).toBe('alternating kettlebell floor press')
  })
  it('drops filler words and stays within the search limits', () => {
    expect(simplifyExerciseName('Turkish get-up to the floor')).toBe('turkish get-up floor')
    expect(simplifyExerciseName('x'.repeat(80)).length).toBeLessThanOrEqual(60)
  })
  it('falls back to the trimmed name when the cut leaves too little', () => {
    expect(simplifyExerciseName('  (abc) ')).toBe('(abc)')
    expect(isSearchable(simplifyExerciseName('Farmer carry'))).toBe(true)
  })
})

describe('isSearchable', () => {
  it('accepts 2..60 characters after trimming', () => {
    expect(isSearchable(' a ')).toBe(false)
    expect(isSearchable('ab')).toBe(true)
    expect(isSearchable('x'.repeat(60))).toBe(true)
    expect(isSearchable('x'.repeat(61))).toBe(false)
  })
})

describe('parseSearchResults', () => {
  it('keeps valid ids once, names trimmed, ids as names when missing', () => {
    const r = parseSearchResults({
      results: [
        { id: 'EIeI8Vf', name: ' barbell bench press ' },
        { id: 'EIeI8Vf', name: 'dup' },
        { id: '../x', name: 'path' },
        { id: 'J6Dx1Mu' },
        { id: 42, name: 'number' },
        null,
      ],
    })
    expect(r).toEqual([
      { id: 'EIeI8Vf', name: 'barbell bench press' },
      { id: 'J6Dx1Mu', name: 'J6Dx1Mu' },
    ])
  })
  it('caps at 25 and tolerates junk', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `abcd${i}`, name: `n${i}` }))
    expect(parseSearchResults({ results: many })).toHaveLength(25)
    expect(parseSearchResults(null)).toEqual([])
    expect(parseSearchResults({ results: 'x' })).toEqual([])
  })
})

describe('matchKindOf / applyMatchChange', () => {
  const counts: MatchCounts = { exact: 3, fuzzy: 2, ai: 1, manual: 0, unmatched: 5 }
  it('reads the kind of a row', () => {
    expect(matchKindOf({ exercisedb_id: null, exercisedb_match: null })).toBe('unmatched')
    expect(matchKindOf({ exercisedb_id: 'EIeI8Vf', exercisedb_match: 'ai' })).toBe('ai')
    expect(matchKindOf({ exercisedb_id: 'EIeI8Vf', exercisedb_match: null })).toBe('manual')
  })
  it('moves one row between kinds and never goes below zero', () => {
    expect(applyMatchChange(counts, 'unmatched', 'manual')).toEqual({ ...counts, unmatched: 4, manual: 1 })
    expect(applyMatchChange(counts, 'ai', 'unmatched')).toEqual({ ...counts, ai: 0, unmatched: 6 })
    expect(applyMatchChange(counts, 'manual', 'unmatched').manual).toBe(0)
    expect(applyMatchChange(counts, 'manual', 'manual')).toBe(counts)
  })
})

describe('withoutRow', () => {
  const data = {
    pages: [
      { rows: [{ id: 'a' }, { id: 'b' }], total: 3 },
      { rows: [{ id: 'c' }], total: 3 },
    ],
    pageParams: [0, 1],
  }
  it('drops the row and lowers the total', () => {
    const out = withoutRow(data, 'b')!
    expect(out.pages.flatMap((p) => p.rows.map((r) => r.id))).toEqual(['a', 'c'])
    expect(out.pages.map((p) => p.total)).toEqual([2, 2])
  })
  it('leaves other lists alone', () => {
    expect(withoutRow(data, 'zz')).toBe(data)
    expect(withoutRow(undefined, 'a')).toBeUndefined()
  })
})
