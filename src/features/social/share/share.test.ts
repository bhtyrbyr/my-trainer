import { describe, expect, it } from 'vitest'
import {
  bestSet,
  mealPayload,
  programExerciseIds,
  programPayload,
  programToTemplates,
  relativeTime,
  templateName,
  templateProgramPayload,
  workoutPayload,
} from './payload'
import { ENCODE_ATTEMPTS, MAX_BYTES, MAX_EDGE, compareLayout, fitWithin, fitsLimit, remainingSlots } from './imageSize'

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'

describe('bestSet', () => {
  it('picks the heaviest working set, more reps on a tie, and ignores warm-ups', () => {
    expect(
      bestSet([
        { weight_kg: 100, reps: 3, is_warmup: true },
        { weight_kg: 80, reps: 8 },
        { weight_kg: 85, reps: 5 },
        { weight_kg: 85, reps: 6 },
      ]),
    ).toEqual({ weight_kg: 85, reps: 6 })
  })
  it('compares bodyweight sets by reps and returns undefined without working sets', () => {
    expect(bestSet([{ weight_kg: null, reps: 10 }, { weight_kg: 0, reps: 14 }])).toEqual({ weight_kg: null, reps: 14 })
    expect(bestSet([{ weight_kg: 60, reps: null }, { weight_kg: 60, reps: 8, is_warmup: true }])).toBeUndefined()
  })
})

describe('workoutPayload', () => {
  it('keeps only the allowed keys, rounds and skips exercises without working sets', () => {
    const p = workoutPayload({
      startedAt: new Date(2026, 9, 31, 18, 5).toISOString(),
      durationSec: 3725.4,
      volumeKg: 5230.456,
      totalSets: 14,
      exercises: [
        { name: '  Bench press ', sets: [{ weight_kg: 80, reps: 8 }] },
        { name: 'Warm-up only', sets: [{ weight_kg: 20, reps: 10, is_warmup: true }] },
        { name: 'Pull-up', sets: [{ weight_kg: null, reps: 9 }] },
      ],
    })
    expect(p).toEqual({
      date: '2026-10-31',
      duration_sec: 3725,
      volume_kg: 5230.5,
      sets: 14,
      exercises: [
        { name: 'Bench press', best: { weight_kg: 80, reps: 8 } },
        { name: 'Pull-up', best: { weight_kg: null, reps: 9 } },
      ],
    })
    expect(Object.keys(p).sort()).toEqual(['date', 'duration_sec', 'exercises', 'sets', 'volume_kg'])
  })
  it('caps exercises at 30 (server limit) and names at 120 characters, never negative numbers', () => {
    const many = Array.from({ length: 70 }, (_, i) => ({ name: `${'x'.repeat(130)}${i}`, sets: [{ weight_kg: 10, reps: 5 }] }))
    const p = workoutPayload({ startedAt: new Date().toISOString(), durationSec: null, volumeKg: -5, totalSets: null, exercises: many })
    expect(p.exercises).toHaveLength(30)
    expect(p.exercises[0].name).toHaveLength(120)
    expect([p.duration_sec, p.volume_kg, p.sets]).toEqual([0, 0, 0])
    expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThan(16384)
  })
})

describe('programPayload', () => {
  it('drops empty days, clamps reps and keeps exercise ids only when given', () => {
    const p = programPayload('Push Pull', [
      { name: 'Push', exercises: [{ name: 'Bench', exercise_id: ID_A, sets: 4, reps_low: 10, reps_high: 6 }] },
      { name: 'Empty', exercises: [] },
      { name: '', exercises: [{ name: 'Custom row', exercise_id: null, sets: 0, reps_low: 0, reps_high: 900 }] },
    ])
    expect(p.days).toHaveLength(2)
    expect(p.days[0].exercises[0]).toEqual({ name: 'Bench', exercise_id: ID_A, sets: 4, reps_low: 10, reps_high: 10 })
    expect(p.days[1]).toEqual({ name: 'Push Pull', exercises: [{ name: 'Custom row', sets: 1, reps_low: 1, reps_high: 500 }] })
  })
  it('turns a template into a one-day program; custom exercises travel by name only', () => {
    const p = templateProgramPayload(
      {
        name: 'Leg day',
        exercises: [
          { exercise_id: ID_A, target_sets: 3, target_reps_low: 8, target_reps_high: 12 },
          { exercise_id: ID_B, target_sets: 2, target_reps_low: 15, target_reps_high: 15 },
        ],
      },
      (id) => (id === ID_A ? { name: 'Squat', isCustom: false } : { name: 'My machine', isCustom: true }),
    )
    expect(p).toEqual({
      name: 'Leg day',
      days: [
        {
          name: 'Leg day',
          exercises: [
            { name: 'Squat', exercise_id: ID_A, sets: 3, reps_low: 8, reps_high: 12 },
            { name: 'My machine', sets: 2, reps_low: 15, reps_high: 15 },
          ],
        },
      ],
    })
  })
})

describe('mealPayload', () => {
  it('rounds macros and omits an empty name', () => {
    expect(mealPayload({ name: '  ', kcal: 512.6, protein_g: 31.26, carb_g: 40, fat_g: -1 })).toEqual({ kcal: 513, protein_g: 31.3, carb_g: 40, fat_g: 0 })
    expect(mealPayload({ name: 'Oats', kcal: 300, protein_g: 10, carb_g: 50, fat_g: 6 }).name).toBe('Oats')
  })
})

describe('programToTemplates', () => {
  const program = {
    name: 'Split',
    days: [
      { name: 'Push', exercises: [{ name: 'Bench', exercise_id: ID_A, sets: 4, reps_low: 6, reps_high: 8 }, { name: 'Cable thing', sets: 3, reps_low: 12, reps_high: 12 }] },
      { name: 'Custom day', exercises: [{ name: 'Unknown', exercise_id: ID_B, sets: 3, reps_low: 10, reps_high: 10 }] },
    ],
  }
  it('keeps catalog exercises, reports the rest and skips days left empty', () => {
    let n = 0
    const copy = programToTemplates(program, new Set([ID_A]), () => `id-${++n}`)
    expect(copy.templates).toEqual([
      { name: 'Split - Push', weekdays: [], exercises: [{ id: 'id-1', exercise_id: ID_A, target_sets: 4, target_reps_low: 6, target_reps_high: 8, rest_seconds: 90 }] },
    ])
    expect(copy.skipped).toEqual(['Cable thing', 'Unknown'])
    expect(programExerciseIds(program)).toEqual([ID_A, ID_B])
  })
  it('names a one-day program after the program and keeps names within 80 characters', () => {
    expect(templateName('Leg day', 'Leg day', true)).toBe('Leg day')
    expect(templateName('P'.repeat(70), 'Day one', false)).toHaveLength(80)
  })
})

describe('relativeTime', () => {
  const now = new Date('2026-11-01T12:00:00Z')
  it('buckets into now / minutes / hours / days / date', () => {
    expect(relativeTime(new Date('2026-11-01T11:59:30Z'), now)).toEqual({ unit: 'now', n: 0 })
    expect(relativeTime(new Date('2026-11-01T11:15:00Z'), now)).toEqual({ unit: 'm', n: 45 })
    expect(relativeTime(new Date('2026-11-01T02:00:00Z'), now)).toEqual({ unit: 'h', n: 10 })
    expect(relativeTime(new Date('2026-10-29T12:00:00Z'), now)).toEqual({ unit: 'd', n: 3 })
    expect(relativeTime(new Date('2026-10-01T12:00:00Z'), now).unit).toBe('date')
  })
})

describe('image size rules', () => {
  it('fits the long edge within 1280 px without upscaling', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: MAX_EDGE, height: 960 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 960, height: MAX_EDGE })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(10000, 3)).toEqual({ width: MAX_EDGE, height: 1 })
  })
  it('starts at q0.8 and 1280 px, then only gets smaller', () => {
    expect(ENCODE_ATTEMPTS[0]).toEqual({ maxEdge: 1280, quality: 0.8 })
    for (let i = 1; i < ENCODE_ATTEMPTS.length; i++) {
      const [a, b] = [ENCODE_ATTEMPTS[i - 1], ENCODE_ATTEMPTS[i]]
      expect(b.maxEdge * b.maxEdge * b.quality).toBeLessThan(a.maxEdge * a.maxEdge * a.quality)
    }
  })
  it('accepts files up to 600 KB and limits a post to 4 images', () => {
    expect(fitsLimit(MAX_BYTES)).toBe(true)
    expect(fitsLimit(MAX_BYTES + 1)).toBe(false)
    expect(fitsLimit(0)).toBe(false)
    expect(remainingSlots(3)).toBe(1)
    expect(remainingSlots(5)).toBe(0)
    expect(remainingSlots(0, 1)).toBe(1)
  })
  it('lays out a compare composite side by side within the long-edge limit', () => {
    const L = compareLayout({ width: 1600, height: 2133 }, { width: 1200, height: 1600 })
    expect(Math.max(L.width, L.height)).toBeLessThanOrEqual(MAX_EDGE)
    expect(L.left.h).toBe(L.right.h)
    expect(L.right.x).toBeGreaterThan(L.left.x + L.left.w)
    expect(L.right.x + L.right.w).toBe(L.width)
    expect(L.band.y + L.band.h).toBe(L.height)
  })
})
