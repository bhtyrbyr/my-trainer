import { describe, expect, it } from 'vitest'
import { daysToNextTier, effectiveStreak, streakTier } from './streak'

describe('effectiveStreak', () => {
  const today = new Date(2026, 9, 26, 22, 0)
  it('keeps the streak when active today or yesterday', () => {
    expect(effectiveStreak(12, '2026-10-26', today)).toBe(12)
    expect(effectiveStreak(12, '2026-10-25', today)).toBe(12)
  })
  it('drops to 0 after a missed day', () => {
    expect(effectiveStreak(12, '2026-10-24', today)).toBe(0)
  })
  it('handles missing data', () => {
    expect(effectiveStreak(0, '2026-10-26', today)).toBe(0)
    expect(effectiveStreak(5, null, today)).toBe(0)
  })
})

describe('streakTier', () => {
  it.each([
    [0, 'none'],
    [1, 'low'],
    [4, 'low'],
    [5, 'medium'],
    [14, 'medium'],
    [15, 'high'],
    [29, 'high'],
    [30, 'legendary'],
    [44, 'legendary'],
    [45, 'mythic'],
    [365, 'mythic'],
    [-3, 'none'],
  ] as const)('%i days -> %s', (days, tier) => {
    expect(streakTier(days)).toBe(tier)
  })
})

describe('daysToNextTier', () => {
  it('counts down to the next boundary', () => {
    expect(daysToNextTier(0)).toBe(1)
    expect(daysToNextTier(3)).toBe(2)
    expect(daysToNextTier(5)).toBe(10)
    expect(daysToNextTier(29)).toBe(1)
    expect(daysToNextTier(30)).toBe(15)
    expect(daysToNextTier(44)).toBe(1)
    expect(daysToNextTier(45)).toBeNull()
  })
})
