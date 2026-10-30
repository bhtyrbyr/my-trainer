import { describe, expect, it } from 'vitest'
import {
  allSuggestions,
  lastTrainedByPart,
  parseDismissed,
  partKey,
  pickSuggestions,
  stalestPart,
  statGrid,
  weekStartOf,
  weekStats,
  withDismissed,
  type SuggestionInput,
} from './logic'
import type { WeekSummary } from './schema'

const at = (hour: number, minute = 0) => new Date(2026, 9, 29, hour, minute) // Thu 29 Oct 2026, local
const TODAY = '2026-10-29'

const base = (over: Partial<SuggestionInput> = {}): SuggestionInput => ({
  now: at(12),
  today: TODAY,
  streak: 0,
  lastActiveOn: null,
  habitsOpen: 0,
  trainedParts: {},
  health: null,
  ...over,
})

const ids = (input: SuggestionInput) => allSuggestions(input).map((s) => s.id)

describe('streak at risk', () => {
  it('fires from 20:00 when the streak is alive and nothing earned points today', () => {
    expect(ids(base({ now: at(20), streak: 5, lastActiveOn: '2026-10-28' }))).toEqual(['streak'])
    expect(ids(base({ now: at(19, 59), streak: 5, lastActiveOn: '2026-10-28' }))).toEqual([])
  })
  it('stays silent once today counted or without a streak', () => {
    expect(ids(base({ now: at(21), streak: 5, lastActiveOn: TODAY }))).toEqual([])
    expect(ids(base({ now: at(21), streak: 0, lastActiveOn: '2026-10-20' }))).toEqual([])
  })
})

describe('habits due but undone', () => {
  it('fires from 17:00 with the open count', () => {
    expect(allSuggestions(base({ now: at(17), habitsOpen: 2 }))).toEqual([
      { id: 'habits', kind: 'habits', open: 2 },
    ])
    expect(ids(base({ now: at(16), habitsOpen: 2 }))).toEqual([])
  })
  it('stays silent while unknown or all done', () => {
    expect(ids(base({ now: at(22), habitsOpen: null }))).toEqual([])
    expect(ids(base({ now: at(22), habitsOpen: 0 }))).toEqual([])
  })
})

describe('water', () => {
  const health = { waterMl: 900, waterGoal: 2500, lastWeighIn: null }
  it('fires after 18:00 below 40% of the goal', () => {
    expect(allSuggestions(base({ now: at(18), health }))).toEqual([{ id: 'water', kind: 'water', pct: 36 }])
    expect(ids(base({ now: at(17), health }))).toEqual([])
    expect(ids(base({ now: at(19), health: { ...health, waterMl: 1000 } }))).toEqual([])
  })
  it('needs health consent', () => {
    expect(ids(base({ now: at(23), health: null }))).toEqual([])
  })
})

describe('muscle groups', () => {
  it('picks the major part resting longest, at least 4 days', () => {
    const parts = { chest: '2026-10-27', back: '2026-10-24', upper_legs: '2026-10-22', cardio: '2026-10-01' }
    expect(stalestPart(parts, TODAY)).toEqual({ part: 'upper_legs', days: 7 })
    expect(allSuggestions(base({ trainedParts: parts }))).toEqual([
      { id: 'muscle:upper_legs', kind: 'muscle', part: 'upper_legs', days: 7 },
    ])
  })
  it('ignores minor parts, short rests and parts out of rotation', () => {
    expect(stalestPart({ chest: '2026-10-26', neck: '2026-10-01' }, TODAY)).toBeNull()
    expect(stalestPart({ back: '2026-09-30' }, TODAY)).toBeNull() // 29 days: no longer in rotation
    expect(stalestPart({ back: '2026-10-01' }, TODAY)).toEqual({ part: 'back', days: 28 })
    expect(stalestPart(null, TODAY)).toBeNull()
  })
})

describe('weigh-in', () => {
  it('fires after 7 days without one, only for people who weigh in', () => {
    const h = (lastWeighIn: string | null) => ({ waterMl: 3000, waterGoal: 2500, lastWeighIn })
    expect(allSuggestions(base({ health: h('2026-10-22') }))).toEqual([
      { id: 'weigh', kind: 'weigh', days: 7 },
    ])
    expect(ids(base({ health: h('2026-10-23') }))).toEqual([])
    expect(ids(base({ health: h(null) }))).toEqual([])
  })
})

describe('pickSuggestions', () => {
  const busy = base({
    now: at(21),
    streak: 3,
    lastActiveOn: '2026-10-28',
    habitsOpen: 1,
    trainedParts: { chest: '2026-10-20' },
    health: { waterMl: 0, waterGoal: 2500, lastWeighIn: '2026-10-01' },
  })
  it('orders by urgency and shows at most two', () => {
    expect(ids(busy)).toEqual(['streak', 'habits', 'water', 'muscle:chest', 'weigh'])
    expect(pickSuggestions(busy, new Set()).map((s) => s.id)).toEqual(['streak', 'habits'])
  })
  it('skips the ones dismissed today', () => {
    expect(pickSuggestions(busy, new Set(['streak', 'water'])).map((s) => s.id)).toEqual([
      'habits',
      'muscle:chest',
    ])
  })
})

describe('dismissed memory', () => {
  it('round-trips for the same day and resets on a new day', () => {
    const once = withDismissed(null, TODAY, 'water')
    const twice = withDismissed(once, TODAY, 'muscle:back')
    expect([...parseDismissed(twice, TODAY)]).toEqual(['water', 'muscle:back'])
    expect(parseDismissed(twice, '2026-10-30').size).toBe(0)
    expect([...parseDismissed(withDismissed(twice, '2026-10-30', 'weigh'), '2026-10-30')]).toEqual(['weigh'])
  })
  it('survives garbage', () => {
    for (const raw of [
      '',
      '{',
      'null',
      '42',
      '{"day":"2026-10-29","ids":"x"}',
      '{"day":"2026-10-29","ids":[1,"ok"]}',
    ]) {
      expect(() => parseDismissed(raw, TODAY)).not.toThrow()
    }
    expect([...parseDismissed('{"day":"2026-10-29","ids":[1,"ok"]}', TODAY)]).toEqual(['ok'])
  })
})

describe('body parts', () => {
  it('normalises names like the exercise vocabulary', () => {
    expect(partKey('Upper Arms')).toBe('upper_arms')
    expect(partKey(' upper-legs ')).toBe('upper_legs')
  })
  it('keeps the latest day per part', () => {
    expect(
      lastTrainedByPart([
        { day: '2026-10-20', parts: ['chest', 'upper arms'] },
        { day: '2026-10-27', parts: ['chest'] },
        { day: '2026-10-25', parts: ['upper arms', 'back'] },
      ]),
    ).toEqual({ chest: '2026-10-27', upper_arms: '2026-10-25', back: '2026-10-25' })
  })
})

describe('week', () => {
  const summary: WeekSummary = {
    week_start: '2026-10-26',
    workouts: 3,
    sets: 42,
    volume_kg: 8420,
    cardio_minutes: 30,
    habit_rate: 0.857,
    todos_done: 4,
    avg_sleep_minutes: 432,
    weight_change_kg: -0.4,
    water_goal_days: 3,
  }
  it('lists supporting stats, dropping what the server did not return', () => {
    expect(weekStats(summary).map((s) => s.key)).toEqual(['habits', 'todos', 'sleep', 'weight', 'water'])
    const noHealth = {
      ...summary,
      avg_sleep_minutes: null,
      weight_change_kg: null,
      water_goal_days: null,
      habit_rate: null,
    }
    expect(weekStats(noHealth)).toEqual([{ key: 'todos', count: 4 }])
  })
  it('keeps a weight change of exactly zero', () => {
    expect(weekStats({ ...summary, weight_change_kg: 0 }).some((s) => s.key === 'weight')).toBe(true)
  })
  it('lays out full rows', () => {
    expect(statGrid(1)).toEqual({ cols: 1, spans: [1] })
    expect(statGrid(3)).toEqual({ cols: 3, spans: [1, 1, 1] })
    expect(statGrid(4)).toEqual({ cols: 2, spans: [1, 1, 1, 1] })
    expect(statGrid(5)).toEqual({ cols: 3, spans: [1, 1, 1, 1, 2] })
  })
  it('finds Mondays', () => {
    expect(weekStartOf('2026-10-29')).toBe('2026-10-26')
    expect(weekStartOf('2026-11-01')).toBe('2026-10-26') // Sunday
    expect(weekStartOf('2026-10-26', -1)).toBe('2026-10-19')
  })
})
