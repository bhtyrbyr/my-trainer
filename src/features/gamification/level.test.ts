import { describe, expect, it } from 'vitest'
import { POINTS_PER_LEVEL, levelProgress } from './level'

describe('levelProgress', () => {
  it('starts at level 1 with the whole level to go', () => {
    expect(levelProgress(0)).toEqual({ level: 1, into: 0, toNext: POINTS_PER_LEVEL, ratio: 0 })
  })
  it('counts floor(points / 1000) + 1 and the remainder inside the level', () => {
    expect(levelProgress(999)).toEqual({ level: 1, into: 999, toNext: 1, ratio: 0.999 })
    expect(levelProgress(1000)).toEqual({ level: 2, into: 0, toNext: 1000, ratio: 0 })
    expect(levelProgress(2340)).toEqual({ level: 3, into: 340, toNext: 660, ratio: 0.34 })
  })
  it('clamps negative, fractional and non-finite totals', () => {
    expect(levelProgress(-50).level).toBe(1)
    expect(levelProgress(1500.9)).toMatchObject({ level: 2, into: 500 })
    expect(levelProgress(Number.NaN).level).toBe(1)
  })
})
