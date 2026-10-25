import { describe, expect, it } from 'vitest'
// @ts-expect-error -- plain ESM helper shared with the Node sync script (no type declarations)
import { isBrandedDescription, parseCsvLine, pickEnergy } from '../../scripts/food-catalog-lib.mjs'
import catalog from '../../scripts/food-catalog-tr.json'

describe('food catalog sync helpers', () => {
  it('parses quoted CSV fields', () => {
    expect(parseCsvLine('"170379","sr_legacy_food","Cheese, feta","1","2019-04-01"')).toEqual(['170379', 'sr_legacy_food', 'Cheese, feta', '1', '2019-04-01'])
    expect(parseCsvLine('1,"He said ""hi""",,3')).toEqual(['1', 'He said "hi"', '', '3'])
  })
  it('picks energy in priority order', () => {
    expect(pickEnergy({ '2047': 150, '1008': 140 }, [1008, 2048, 2047])).toBe(140)
    expect(pickEnergy({ '2047': 150 }, [1008, 2048, 2047])).toBe(150)
    expect(pickEnergy({}, [1008])).toBeNull()
  })
  it('detects branded SR Legacy descriptions', () => {
    expect(isBrandedDescription("KELLOGG'S, Corn Flakes")).toBe(true)
    expect(isBrandedDescription("McDONALD'S, Hamburger")).toBe(true)
    expect(isBrandedDescription('Cheese, feta')).toBe(false)
    expect(isBrandedDescription('Rice, white, long-grain, regular, cooked')).toBe(false)
  })
})

describe('curated Turkish catalog', () => {
  const items = (catalog as { items: { id: string; kcal: number; protein: number; carb: number; fat: number; portion_g: number }[] }).items
  it('has unique ids and sane values', () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
    for (const i of items) {
      expect(i.kcal).toBeGreaterThanOrEqual(0)
      expect(i.kcal).toBeLessThanOrEqual(900)
      expect(i.protein + i.carb + i.fat).toBeLessThanOrEqual(100)
      expect(i.portion_g).toBeGreaterThan(0)
    }
  })
  it('energy roughly matches macros (Atwater, within 30%)', () => {
    for (const i of items.filter((x) => x.kcal > 20)) {
      const atwater = 4 * i.protein + 4 * i.carb + 9 * i.fat
      expect(Math.abs(atwater - i.kcal) / i.kcal).toBeLessThan(0.3)
    }
  })
})
