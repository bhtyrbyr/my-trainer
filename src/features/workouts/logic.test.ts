import { describe, expect, it } from 'vitest'
import {
  cardioValues,
  clamp,
  daysUntil,
  draftKey,
  e1rm,
  emptyDraft,
  estimateDurationSec,
  extendRest,
  formatClock,
  formatSetList,
  groupByWeekday,
  isoWeekday,
  matchTargets,
  monthGrid,
  nextExerciseIndex,
  nextPlannedDay,
  nextPosition,
  normalizeWeekdays,
  paceSecPerKm,
  parseDecimal,
  parseDraft,
  prefillNextSet,
  restProgress,
  restRemainingMs,
  restRemainingSec,
  roundMinutes,
  sessionVolumeKg,
  shouldAlertRestEnd,
  stepValue,
  toggleWeekday,
  trainingDays,
  workingSetCount,
} from './logic'

describe('ISO weekdays', () => {
  it('Monday is 1 and Sunday is 7', () => {
    expect(isoWeekday(new Date(2026, 9, 26))).toBe(1) // Mon 26 Oct 2026
    expect(isoWeekday(new Date(2026, 9, 25))).toBe(7) // Sun 25 Oct 2026
    expect(isoWeekday(new Date(2026, 9, 31))).toBe(6) // Sat
  })

  it('normalizes: dedupes, sorts, drops invalid values', () => {
    expect(normalizeWeekdays([5, 1, 5, 0, 8, 3, 2.5])).toEqual([1, 3, 5])
    expect(normalizeWeekdays(null)).toEqual([])
    expect(normalizeWeekdays(undefined)).toEqual([])
  })

  it('toggles a day on and off, keeping order', () => {
    expect(toggleWeekday([3, 1], 2)).toEqual([1, 2, 3])
    expect(toggleWeekday([1, 2, 3], 2)).toEqual([1, 3])
    expect(toggleWeekday([], 7)).toEqual([7])
  })

  it('counts days forward across the week boundary', () => {
    expect(daysUntil(1, 1)).toBe(0)
    expect(daysUntil(1, 3)).toBe(2)
    expect(daysUntil(6, 1)).toBe(2)
    expect(daysUntil(7, 6)).toBe(6)
  })
})

describe('nextPlannedDay', () => {
  const push = { id: 'push', weekdays: [1, 4] }
  const pull = { id: 'pull', weekdays: [2, 5] }
  const legs = { id: 'legs', weekdays: [3], archived: true }

  it('finds the first later day with a plan', () => {
    expect(nextPlannedDay([push, pull], 1)).toMatchObject({ weekday: 2, daysAhead: 1 })
    expect(nextPlannedDay([push, pull], 5)?.weekday).toBe(1)
    expect(nextPlannedDay([push, pull], 5)?.daysAhead).toBe(3)
  })

  it('skips archived templates', () => {
    expect(nextPlannedDay([legs, push], 2)).toMatchObject({ weekday: 4, templates: [push] })
  })

  it('returns next week when the only plan is today', () => {
    expect(nextPlannedDay([{ id: 'x', weekdays: [3] }], 3)).toMatchObject({ weekday: 3, daysAhead: 7 })
  })

  it('returns all plans of that day and null when nothing is planned', () => {
    const extra = { id: 'core', weekdays: [2] }
    expect(nextPlannedDay([push, pull, extra], 1)?.templates.map((t) => t.id)).toEqual(['pull', 'core'])
    expect(nextPlannedDay([{ id: 'a', weekdays: [] }], 1)).toBeNull()
    expect(nextPlannedDay([], 1)).toBeNull()
  })
})

describe('groupByWeekday', () => {
  it('lists every weekday Monday first, repeats multi-day plans, and keeps unassigned apart', () => {
    const g = groupByWeekday([
      { id: 'push', weekdays: [4, 1] },
      { id: 'free', weekdays: [] },
      { id: 'old', weekdays: [1], archived: true },
    ])
    expect(g.days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(g.days[0].templates.map((t) => t.id)).toEqual(['push'])
    expect(g.days[3].templates.map((t) => t.id)).toEqual(['push'])
    expect(g.days[1].templates).toEqual([])
    expect(g.unassigned.map((t) => t.id)).toEqual(['free'])
  })
})

describe('estimateDurationSec', () => {
  it('is zero for an empty plan', () => {
    expect(estimateDurationSec([])).toBe(0)
    expect(roundMinutes(0)).toBe(0)
  })

  it('counts work, rests between sets (not after the last) and transitions', () => {
    // 3 sets x 10 reps avg: work 3*(10*3+20)=150, rest 2*90=180 -> 330
    const one = { target_sets: 3, target_reps_low: 8, target_reps_high: 12, rest_seconds: 90 }
    expect(estimateDurationSec([one])).toBe(330)
    // second exercise adds its own 330 + 60 transition
    expect(estimateDurationSec([one, one])).toBe(720)
  })

  it('falls back to the default rest and tolerates high < low', () => {
    const ex = { target_sets: 2, target_reps_low: 10, target_reps_high: 6, rest_seconds: null }
    // reps avg (10+10)/2 = 10 -> work 2*50 = 100, rest 1*90 -> 190
    expect(estimateDurationSec([ex])).toBe(190)
  })

  it('rounds to 5-minute steps with a 5-minute floor', () => {
    expect(roundMinutes(60)).toBe(5)
    expect(roundMinutes(44 * 60)).toBe(45)
    expect(roundMinutes(52 * 60)).toBe(50)
    expect(roundMinutes(53 * 60)).toBe(55)
  })
})

describe('volume, sets and e1RM', () => {
  const sets = [
    { weight_kg: 60, reps: 10, is_warmup: true },
    { weight_kg: 80, reps: 8 },
    { weight_kg: 80, reps: 8, is_warmup: false },
    { weight_kg: 75, reps: 10 },
    { weight_kg: 100, reps: 0 },
    { weight_kg: null, reps: 12 },
  ]

  it('excludes warmups and zero-rep sets like the server does', () => {
    expect(sessionVolumeKg(sets)).toBe(80 * 8 * 2 + 750)
    expect(workingSetCount(sets)).toBe(4)
  })

  it('rounds volume to one decimal', () => {
    expect(sessionVolumeKg([{ weight_kg: 33.33, reps: 3 }])).toBe(100)
    expect(sessionVolumeKg([{ weight_kg: 22.75, reps: 3 }])).toBe(68.3)
    expect(sessionVolumeKg([])).toBe(0)
  })

  it('computes Epley e1RM and rejects missing values', () => {
    expect(e1rm(100, 5)).toBe(116.67)
    expect(e1rm(100, 1)).toBe(103.33)
    expect(e1rm(0, 5)).toBeNull()
    expect(e1rm(null, 5)).toBeNull()
    expect(e1rm(100, 0)).toBeNull()
  })
})

describe('prefillNextSet', () => {
  const last = [
    { weight_kg: 40, reps: 12, is_warmup: true },
    { weight_kg: 80, reps: 8 },
    { weight_kg: 80, reps: 8 },
    { weight_kg: 75, reps: 10 },
  ]

  it('maps the n-th working set to last time, ignoring warmups', () => {
    expect(prefillNextSet({ lastTime: last, thisSession: [] })).toEqual({ weightKg: 80, reps: 8, source: 'last' })
    const done = [{ weight_kg: 50, reps: 10, is_warmup: true }, { weight_kg: 82.5, reps: 8 }, { weight_kg: 82.5, reps: 7 }]
    expect(prefillNextSet({ lastTime: last, thisSession: done })).toEqual({ weightKg: 75, reps: 10, source: 'last' })
  })

  it('falls back to the previous set in this session once last time runs out', () => {
    const done = [{ weight_kg: 80, reps: 8 }, { weight_kg: 80, reps: 8 }, { weight_kg: 77.5, reps: 9 }]
    expect(prefillNextSet({ lastTime: last, thisSession: done, targetRepsLow: 6 })).toEqual({
      weightKg: 77.5,
      reps: 9,
      source: 'session',
    })
  })

  it('uses the previous set (even a warmup) when there is no history', () => {
    expect(prefillNextSet({ lastTime: [], thisSession: [{ weight_kg: 40, reps: 12, is_warmup: true }] })).toEqual({
      weightKg: 40,
      reps: 12,
      source: 'session',
    })
  })

  it('falls back to the plan target, then to nothing', () => {
    expect(prefillNextSet({ lastTime: [], thisSession: [], targetRepsLow: 8 })).toEqual({ weightKg: null, reps: 8, source: 'target' })
    expect(prefillNextSet({ lastTime: [], thisSession: [], targetRepsLow: null })).toEqual({ weightKg: null, reps: null, source: 'none' })
    expect(prefillNextSet({ lastTime: [{ weight_kg: 50, reps: 0 }], thisSession: [] })).toEqual({ weightKg: null, reps: null, source: 'none' })
  })
})

describe('rest timer', () => {
  const t0 = 1_000_000

  it('derives remaining time from the end timestamp only', () => {
    expect(restRemainingMs(t0 + 90_000, t0)).toBe(90_000)
    expect(restRemainingMs(t0 + 90_000, t0 + 120_000)).toBe(0)
    expect(restRemainingMs(null, t0)).toBe(0)
    expect(restRemainingMs(Number.NaN, t0)).toBe(0)
  })

  it('rounds seconds up so 0 only shows at the end', () => {
    expect(restRemainingSec(t0 + 89_001, t0)).toBe(90)
    expect(restRemainingSec(t0 + 1, t0)).toBe(1)
    expect(restRemainingSec(t0, t0)).toBe(0)
  })

  it('extends a running timer and restarts an expired one from now', () => {
    expect(extendRest(t0 + 10_000, t0, 30)).toBe(t0 + 40_000)
    expect(extendRest(t0 - 5_000, t0, 30)).toBe(t0 + 30_000)
    expect(extendRest(null, t0, 30)).toBe(t0 + 30_000)
  })

  it('reports progress as the remaining share, capped at 1', () => {
    expect(restProgress(t0 + 45_000, 90, t0)).toBe(0.5)
    expect(restProgress(t0 + 120_000, 90, t0)).toBe(1) // after +30 s
    expect(restProgress(t0 - 1, 90, t0)).toBe(0)
    expect(restProgress(null, 90, t0)).toBe(0)
    expect(restProgress(t0 + 1000, 0, t0)).toBe(0)
  })

  it('alerts only for a fresh end, not when resuming long after', () => {
    expect(shouldAlertRestEnd(t0, t0 + 500)).toBe(true)
    expect(shouldAlertRestEnd(t0, t0 - 1)).toBe(false)
    expect(shouldAlertRestEnd(t0, t0 + 60_000)).toBe(false)
  })

  it('formats clocks', () => {
    expect(formatClock(90)).toBe('1:30')
    expect(formatClock(5)).toBe('0:05')
    expect(formatClock(3725)).toBe('1:02:05')
    expect(formatClock(-3)).toBe('0:00')
    expect(formatClock(59.9)).toBe('0:59')
  })
})

describe('numbers and units', () => {
  it('parses decimal input with comma or dot', () => {
    expect(parseDecimal('82,5')).toBe(82.5)
    expect(parseDecimal(' 80 ')).toBe(80)
    expect(parseDecimal('.5')).toBe(0.5)
    expect(parseDecimal('80.')).toBe(80)
    expect(parseDecimal('')).toBeNull()
    expect(parseDecimal('abc')).toBeNull()
    expect(parseDecimal('-5')).toBeNull()
    expect(parseDecimal('1.2.3')).toBeNull()
  })

  it('steps onto the plate grid and respects bounds', () => {
    expect(stepValue(80, 2.5)).toBe(82.5)
    expect(stepValue(81, 2.5)).toBe(82.5)
    expect(stepValue(81, -2.5)).toBe(80)
    expect(stepValue(80, -2.5)).toBe(77.5)
    expect(stepValue(null, 2.5)).toBe(2.5)
    expect(stepValue(1, -2.5)).toBe(0)
    expect(stepValue(8, 1)).toBe(9)
    expect(stepValue(1, -1, 1)).toBe(1)
    expect(stepValue(50, 1, 1, 50)).toBe(50)
    expect(clamp(5, 1, 3)).toBe(3)
  })

  it('formats a set list without warmups', () => {
    const fmt = (n: number) => String(n)
    expect(
      formatSetList(
        [
          { weight_kg: 40, reps: 12, is_warmup: true },
          { weight_kg: 80, reps: 8 },
          { weight_kg: 75, reps: 10 },
          { weight_kg: null, reps: 15 },
        ],
        fmt,
      ),
    ).toEqual(['80 × 8', '75 × 10', '15'])
  })
})

describe('session structure', () => {
  const t = (exercise_id: string, position: number, sets = 3) => ({
    exercise_id,
    position,
    target_sets: sets,
    target_reps_low: 8,
    target_reps_high: 12,
    rest_seconds: 90,
  })

  it('matches targets by position and exercise, then by exercise', () => {
    const targets = [t('bench', 0, 4), t('row', 1), t('bench', 2, 2)]
    const se = [
      { id: 'a', exercise_id: 'bench', position: 0 },
      { id: 'b', exercise_id: 'row', position: 1 },
      { id: 'c', exercise_id: 'bench', position: 5 }, // moved
      { id: 'd', exercise_id: 'curl', position: 6 }, // added mid-session
    ]
    const m = matchTargets(se, targets)
    expect(m.get('a')?.target_sets).toBe(4)
    expect(m.get('b')?.exercise_id).toBe('row')
    expect(m.get('c')?.target_sets).toBe(2)
    expect(m.has('d')).toBe(false)
  })

  it('computes the next position', () => {
    expect(nextPosition([])).toBe(0)
    expect(nextPosition([{ position: 0 }, { position: 4 }, { position: 2 }])).toBe(5)
  })

  it('finds the next non-skipped exercise', () => {
    const ex = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    expect(nextExerciseIndex(ex, 0, [])).toBe(1)
    expect(nextExerciseIndex(ex, 0, ['b', 'c'])).toBe(3)
    expect(nextExerciseIndex(ex, 0, new Set(['b', 'c', 'd']))).toBeNull()
    expect(nextExerciseIndex(ex, 3, [])).toBeNull()
  })
})

describe('draft', () => {
  it('keys drafts per session', () => {
    expect(draftKey('abc')).toBe('mt.workout.draft.abc')
  })

  it('round-trips a valid draft', () => {
    const d = { v: 1 as const, exerciseIndex: 2, restEndsAt: 1234, restTotalSec: 90, skipped: ['x'] }
    expect(parseDraft(JSON.stringify(d))).toEqual(d)
  })

  it('survives missing, corrupt or partial data', () => {
    expect(parseDraft(null)).toEqual(emptyDraft())
    expect(parseDraft('{not json')).toEqual(emptyDraft())
    expect(parseDraft('42')).toEqual(emptyDraft())
    expect(parseDraft(JSON.stringify({ exerciseIndex: -3, restEndsAt: 'soon', skipped: ['a', 5] }))).toEqual({
      v: 1,
      exerciseIndex: 0,
      restEndsAt: null,
      restTotalSec: null,
      skipped: ['a'],
    })
    expect(parseDraft(JSON.stringify({ exerciseIndex: 2.7 })).exerciseIndex).toBe(2)
  })
})

describe('calendar', () => {
  it('builds Monday-first weeks that cover the month', () => {
    const weeks = monthGrid(new Date(2026, 9, 15)) // October 2026 starts on a Thursday
    expect(weeks[0][0].key).toBe('2026-09-28')
    expect(weeks[0][3]).toMatchObject({ key: '2026-10-01', inMonth: true })
    expect(weeks[0][0].inMonth).toBe(false)
    expect(weeks.at(-1)?.at(-1)?.key).toBe('2026-11-01')
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(weeks.length).toBe(5)
  })

  it('handles a month that starts on Monday', () => {
    const weeks = monthGrid(new Date(2026, 5, 1)) // June 2026 starts on Monday
    expect(weeks[0][0]).toMatchObject({ key: '2026-06-01', inMonth: true })
  })

  it('collects local training days', () => {
    const local = new Date(2026, 9, 26, 23, 30).toISOString()
    const days = trainingDays([{ started_at: local }, { started_at: local }])
    expect([...days]).toEqual(['2026-10-26'])
  })
})

describe('cardio', () => {
  it('converts form values to row values', () => {
    expect(cardioValues({ minutes: 32.5, distanceKm: 5.25, avgHr: 148.4 })).toEqual({ duration_sec: 1950, distance_m: 5250, avg_hr: 148 })
    expect(cardioValues({ minutes: 20, distanceKm: null, avgHr: 0 })).toEqual({ duration_sec: 1200, distance_m: null, avg_hr: null })
  })

  it('computes pace only with a distance', () => {
    expect(paceSecPerKm(1800, 5000)).toBe(360)
    expect(paceSecPerKm(1800, null)).toBeNull()
    expect(paceSecPerKm(0, 5000)).toBeNull()
  })
})
