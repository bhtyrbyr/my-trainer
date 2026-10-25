import { describe, expect, it } from 'vitest'
import {
  bestE1rm,
  bestWeight,
  changePct,
  filterByPeriod,
  groupSessions,
  periodAverage,
  periodStart,
  summarize,
  toNum,
  type LoggedSet,
  type ProgressPoint,
} from './progress'

const NOW = new Date('2026-10-25T12:00:00Z')

function point(daysAgo: number, avg: number | null, best: number | null = avg, sets = 3, e1rm: number | null = null): ProgressPoint {
  return {
    session_id: `s${daysAgo}`,
    started_at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    avg_weight_kg: avg,
    best_weight_kg: best,
    best_e1rm: e1rm,
    best_reps: 8,
    total_volume_kg: 0,
    total_sets: sets,
  }
}

describe('periodStart', () => {
  it('maps each period to a lower bound', () => {
    expect(periodStart('4w', NOW)?.toISOString()).toBe('2026-09-27T12:00:00.000Z')
    expect(periodStart('3m', NOW)?.toISOString()).toBe('2026-07-25T12:00:00.000Z')
    expect(periodStart('1y', NOW)?.toISOString()).toBe('2025-10-25T12:00:00.000Z')
    expect(periodStart('all', NOW)).toBeNull()
  })
})

describe('filterByPeriod', () => {
  const rows = [point(1, 60), point(40, 50), point(400, 40), point(27, 55)]
  it('keeps sessions in the window, oldest first', () => {
    expect(filterByPeriod(rows, '4w', NOW).map((r) => r.session_id)).toEqual(['s27', 's1'])
    expect(filterByPeriod(rows, '3m', NOW).map((r) => r.session_id)).toEqual(['s40', 's27', 's1'])
    expect(filterByPeriod(rows, 'all', NOW).map((r) => r.session_id)).toEqual(['s400', 's40', 's27', 's1'])
  })
  it('includes the boundary day and excludes future rows', () => {
    expect(filterByPeriod([point(28, 1)], '4w', NOW)).toHaveLength(1)
    expect(filterByPeriod([point(-1, 1)], 'all', NOW)).toHaveLength(0)
  })
})

describe('periodAverage', () => {
  it('weights each session by its working sets', () => {
    expect(periodAverage([point(1, 60, 60, 3), point(2, 40, 40, 1)])).toBe(55)
  })
  it('ignores sessions without a weight and returns null when nothing is weighted', () => {
    expect(periodAverage([point(1, null), point(2, 50)])).toBe(50)
    expect(periodAverage([point(1, null)])).toBeNull()
    expect(periodAverage([])).toBeNull()
  })
  it('counts a zero-set row once instead of dropping it', () => {
    expect(periodAverage([point(1, 30, 30, 0), point(2, 50, 50, 1)])).toBe(40)
  })
})

describe('best values', () => {
  it('picks the maximum and skips nulls', () => {
    const rows = [point(1, 50, 70, 3, 85.5), point(2, 55, null, 3, null), point(3, 52, 72.5, 3, 80)]
    expect(bestWeight(rows)).toBe(72.5)
    expect(bestE1rm(rows)).toBe(85.5)
    expect(bestWeight([])).toBeNull()
  })
})

describe('changePct', () => {
  it('compares the first and last weighted session', () => {
    expect(changePct([point(3, 50), point(2, null), point(1, 55)])).toBeCloseTo(10)
    expect(changePct([point(3, 80), point(1, 60)])).toBeCloseTo(-25)
  })
  it('is null with fewer than two weighted sessions or a zero baseline', () => {
    expect(changePct([point(1, 50)])).toBeNull()
    expect(changePct([point(1, null), point(2, 50)])).toBeNull()
    expect(changePct([point(2, 0), point(1, 50)])).toBeNull()
  })
})

describe('summarize', () => {
  it('bundles the tiles', () => {
    expect(summarize([point(2, 50, 60, 2, 70), point(1, 60, 65, 2, 75)])).toEqual({
      sessions: 2,
      average: 55,
      best: 65,
      e1rm: 75,
      change: 20,
    })
  })
})

describe('toNum', () => {
  it('normalises PostgREST numerics', () => {
    expect(toNum('62.50')).toBe(62.5)
    expect(toNum(3)).toBe(3)
    expect(toNum(null)).toBeNull()
    expect(toNum('')).toBeNull()
    expect(toNum('abc')).toBeNull()
  })
})

describe('groupSessions', () => {
  const set = (session: string, day: string, no: number, w: number | null, r: number | null, warm = false): LoggedSet => ({
    session_id: session,
    started_at: day,
    set_id: `${session}-${no}`,
    set_no: no,
    weight_kg: w,
    reps: r,
    rpe: null,
    is_warmup: warm,
  })
  it('groups by session, newest first, and collapses identical consecutive sets', () => {
    const out = groupSessions([
      set('a', '2026-10-20T10:00:00Z', 1, 40, 12, true),
      set('a', '2026-10-20T10:00:00Z', 2, 60, 10),
      set('a', '2026-10-20T10:00:00Z', 3, 60, 10),
      set('a', '2026-10-20T10:00:00Z', 4, 62.5, 8),
      set('b', '2026-10-23T10:00:00Z', 1, 62.5, 8),
    ])
    expect(out.map((s) => s.session_id)).toEqual(['b', 'a'])
    const a = out[1]
    expect(a.groups).toEqual([
      { weight: 40, reps: 12, count: 1, warmup: true },
      { weight: 60, reps: 10, count: 2, warmup: false },
      { weight: 62.5, reps: 8, count: 1, warmup: false },
    ])
    expect(a.workingSets).toBe(3)
    expect(a.topWeight).toBe(62.5)
  })
  it('keeps a warm-up separate from an identical working set and handles bodyweight sets', () => {
    const out = groupSessions([set('a', '2026-10-20T10:00:00Z', 1, null, 15, true), set('a', '2026-10-20T10:00:00Z', 2, null, 15)])
    expect(out[0].groups).toHaveLength(2)
    expect(out[0].topWeight).toBeNull()
    expect(out[0].workingSets).toBe(1)
  })
})
