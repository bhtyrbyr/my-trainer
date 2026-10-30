import { describe, expect, it } from 'vitest'
import vectors from './recurrence.vectors.json'
import { isValidRule, isoWeekday, matches, occurrencesBetween, streak, weekCountDone, weekStart, type RecurrenceRule } from './recurrence'

describe('recurrence', () => {
  it('agrees with the shared SQL vectors', () => {
    for (const v of vectors) {
      expect(matches(v.rule as RecurrenceRule, v.starts_on, v.day), JSON.stringify(v)).toBe(v.expect)
    }
  })

  it('knows ISO weekdays and week starts (2026-11-02 is a Monday)', () => {
    expect(isoWeekday('2026-11-02')).toBe(1)
    expect(isoWeekday('2026-11-08')).toBe(7)
    expect(weekStart('2026-11-08')).toBe('2026-11-02')
    expect(weekStart('2026-11-02')).toBe('2026-11-02')
  })

  it('validates rules', () => {
    expect(isValidRule({ type: 'daily' })).toBe(true)
    expect(isValidRule({ type: 'weekly', days: [1, 1] })).toBe(false)
    expect(isValidRule({ type: 'weekly', days: [0] })).toBe(false)
    expect(isValidRule({ type: 'weekly_count', n: 3 })).toBe(true)
    expect(isValidRule({ type: 'weekly_count', n: 3 }, false)).toBe(false)
    expect(isValidRule({ type: 'every', n: 1 })).toBe(false)
    expect(isValidRule({ type: 'monthly', day: 32 })).toBe(false)
    expect(isValidRule(null)).toBe(false)
  })

  it('lists occurrences in a range', () => {
    expect(occurrencesBetween({ type: 'weekly', days: [1, 5] }, '2026-11-01', '2026-11-01', '2026-11-14')).toEqual([
      '2026-11-02',
      '2026-11-06',
      '2026-11-09',
      '2026-11-13',
    ])
  })

  it('counts a daily streak without breaking on an unfinished today', () => {
    const done = new Set(['2026-11-05', '2026-11-06', '2026-11-07'])
    expect(streak({ type: 'daily' }, '2026-11-01', done, '2026-11-08')).toBe(3)
    expect(streak({ type: 'daily' }, '2026-11-01', new Set([...done, '2026-11-08']), '2026-11-08')).toBe(4)
    expect(streak({ type: 'daily' }, '2026-11-01', done, '2026-11-09')).toBe(0)
  })

  it('skips days that are not due', () => {
    // Mon/Wed/Fri: done Mon 2nd, Wed 4th, Fri 6th; today Sun 8th
    const done = new Set(['2026-11-02', '2026-11-04', '2026-11-06'])
    expect(streak({ type: 'weekly', days: [1, 3, 5] }, '2026-11-01', done, '2026-11-08')).toBe(3)
  })

  it('counts weekly quotas in whole weeks', () => {
    const done = new Set(['2026-10-26', '2026-10-28', '2026-11-03', '2026-11-05'])
    expect(weekCountDone(done, '2026-11-08')).toBe(2)
    expect(streak({ type: 'weekly_count', n: 2 }, '2026-10-26', done, '2026-11-08')).toBe(2)
    expect(streak({ type: 'weekly_count', n: 3 }, '2026-10-26', done, '2026-11-08')).toBe(0)
  })
})
