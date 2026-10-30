import { describe, expect, it } from 'vitest'
import { BADGES, celebrationQueue, shelfItems, type BadgeCounts } from './logic'

const counts: BadgeCounts = { workouts: 0, streak: 4, sets: 250, photos: 3, habitDays: 12, todos: 50 }

describe('shelfItems', () => {
  it('lists the whole catalog in order with earned dates', () => {
    const items = shelfItems([{ badge_code: 'streak_7', earned_at: '2026-10-28T10:00:00Z' }])
    expect(items.map((i) => i.code)).toEqual(BADGES.map((b) => b.code))
    expect(items.find((i) => i.code === 'streak_7')?.earnedAt).toBe('2026-10-28T10:00:00Z')
    expect(items.every((i) => i.progress === null)).toBe(true) // no counts: someone else's shelf
  })
  it('computes clamped progress for locked badges only', () => {
    const items = shelfItems([{ badge_code: 'first_workout', earned_at: '2026-10-01T00:00:00Z' }], counts)
    const by = Object.fromEntries(items.map((i) => [i.code, i.progress]))
    expect(by.first_workout).toBeNull()
    expect(by.streak_7).toEqual({ value: 4, threshold: 7, ratio: 4 / 7 })
    expect(by.sets_100).toEqual({ value: 100, threshold: 100, ratio: 1 }) // earned server-side any moment now
    expect(by.photos_10?.value).toBe(3)
  })
  it('ignores codes the client does not know', () => {
    expect(shelfItems([{ badge_code: 'future_badge', earned_at: 'x' }]).some((i) => i.earnedAt)).toBe(false)
  })
})

describe('celebrationQueue', () => {
  it('uses the first run as a silent baseline', () => {
    const r = celebrationQueue(['first_workout', 'streak_7'], null)
    expect(r.show).toEqual([])
    expect(JSON.parse(r.seen)).toEqual(['first_workout', 'streak_7'])
  })
  it('shows each new badge once, in catalog order', () => {
    const first = celebrationQueue(
      ['todo_50', 'first_workout', 'streak_7'],
      JSON.stringify(['first_workout']),
    )
    expect(first.show).toEqual(['streak_7', 'todo_50'])
    const again = celebrationQueue(['todo_50', 'first_workout', 'streak_7'], first.seen)
    expect(again.show).toEqual([])
  })
  it('a user with no badges yet still gets the first one celebrated', () => {
    const base = celebrationQueue([], null)
    expect(celebrationQueue(['first_workout'], base.seen).show).toEqual(['first_workout'])
  })
  it('treats unreadable storage as "seen nothing" without throwing', () => {
    expect(celebrationQueue(['first_workout'], '{oops').show).toEqual(['first_workout'])
    expect(celebrationQueue(['nope', 'first_workout'], '[]').show).toEqual(['first_workout'])
  })
})
