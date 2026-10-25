import { describe, expect, it } from 'vitest'
import { bySlot, parseAmount, remaining, scaleDraft, slotForTime, totalsOf } from './logic'
import type { DraftItem, MealEntry } from './types'

const entry = (id: string, slot: string, kcal: number, p = 0, created = '2026-10-25T08:00:00Z'): MealEntry => ({
  id,
  user_id: 'u',
  eaten_on: '2026-10-25',
  meal_slot: slot,
  food_id: null,
  name: id,
  servings: 1,
  kcal,
  protein_g: p,
  carb_g: 1.15,
  fat_g: 0,
  source: 'manual',
  created_at: created,
  updated_at: created,
})

describe('totalsOf', () => {
  it('sums kcal and macros with one decimal', () => {
    expect(totalsOf([entry('a', 'lunch', 300, 20.25), entry('b', 'lunch', 150, 4.5)])).toEqual({ kcal: 450, protein_g: 24.8, carb_g: 2.3, fat_g: 0 })
  })
})

describe('bySlot', () => {
  it('groups by slot in insertion order and folds unknown slots into snacks', () => {
    const g = bySlot([entry('b', 'lunch', 1, 0, '2026-10-25T12:00:00Z'), entry('a', 'lunch', 1, 0, '2026-10-25T11:00:00Z'), entry('x', 'brunch', 1)])
    expect(g.lunch.map((e) => e.id)).toEqual(['a', 'b'])
    expect(g.snack.map((e) => e.id)).toEqual(['x'])
    expect(g.breakfast).toEqual([])
  })
})

describe('slotForTime', () => {
  it('maps the local hour to a meal', () => {
    const at = (h: number) => new Date(2026, 9, 25, h, 30)
    expect([at(7), at(13), at(19), at(23), at(2)].map(slotForTime)).toEqual(['breakfast', 'lunch', 'dinner', 'snack', 'snack'])
  })
})

describe('scaleDraft / remaining / parseAmount', () => {
  const d: DraftItem = { key: 'k', name: 'Yulaf', portion: '40 g', kcal: 150, protein_g: 5.3, carb_g: 27, fat_g: 2.7, source: 'food', food_id: 'f' }
  it('scales by servings', () => {
    expect(scaleDraft(d, 1.5)).toMatchObject({ kcal: 225, protein_g: 8, carb_g: 40.5, fat_g: 4.1 })
  })
  it('computes what is left of a goal', () => {
    expect(remaining(2000, 1640)).toBe(360)
    expect(remaining(null, 1640)).toBeNull()
  })
  it('parses Turkish and English decimals', () => {
    expect(parseAmount('12,5')).toBe(12.5)
    expect(parseAmount('')).toBe(0)
    expect(parseAmount('abc')).toBeNull()
  })
})
