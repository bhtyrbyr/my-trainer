import { describe, expect, it } from 'vitest'
import { filterPeriod, latestMeasurements, summarizeWeight, weightSeries } from './logic'
import type { BodyMetric } from './types'

const row = (measured_on: string, fields: Partial<BodyMetric>): BodyMetric => ({
  id: measured_on,
  user_id: 'u',
  measured_on,
  weight_kg: null,
  waist_cm: null,
  chest_cm: null,
  arm_cm: null,
  hip_cm: null,
  thigh_cm: null,
  note: null,
  created_at: '',
  updated_at: '',
  ...fields,
})

describe('weightSeries', () => {
  it('sorts by day and averages the trailing 7 calendar days', () => {
    const s = weightSeries([row('2026-10-10', { weight_kg: 80 }), row('2026-10-01', { weight_kg: 82 }), row('2026-10-05', { weight_kg: 81 })])
    expect(s.map((p) => p.day)).toEqual(['2026-10-01', '2026-10-05', '2026-10-10'])
    expect(s[1].avg7).toBe(81.5) // 1st and 5th are within 7 days
    expect(s[2].avg7).toBe(80.5) // 5th and 10th; the 1st is 9 days earlier
  })
  it('skips days without a weight', () => {
    expect(weightSeries([row('2026-10-01', { waist_cm: 80 })])).toEqual([])
  })
})

describe('filterPeriod / summarizeWeight', () => {
  const s = weightSeries([row('2026-06-01', { weight_kg: 90 }), row('2026-10-01', { weight_kg: 85 }), row('2026-10-20', { weight_kg: 84 })])
  const now = new Date('2026-10-25T12:00:00')
  it('keeps points inside the period', () => {
    expect(filterPeriod(s, '1m', now).map((p) => p.day)).toEqual(['2026-10-01', '2026-10-20'])
    expect(filterPeriod(s, 'all', now)).toHaveLength(3)
  })
  it('reports latest, change of the average and distance to target', () => {
    const sum = summarizeWeight(filterPeriod(s, '1m', now), 80)
    expect(sum.latest?.kg).toBe(84)
    expect(sum.change).toBe(-1)
    expect(sum.toTarget).toBe(4)
  })
  it('has no change with a single point', () => {
    expect(summarizeWeight(s.slice(0, 1), null).change).toBeNull()
  })
})

describe('latestMeasurements', () => {
  it('takes the newest value per field and the change since the previous one', () => {
    const rows = [row('2026-10-01', { waist_cm: 90, arm_cm: 35 }), row('2026-10-15', { waist_cm: 88 }), row('2026-10-20', { weight_kg: 84 })]
    const m = latestMeasurements(rows)
    const waist = m.find((r) => r.field === 'waist_cm')!
    expect(waist).toMatchObject({ value: 88, day: '2026-10-15', delta: -2 })
    expect(m.find((r) => r.field === 'arm_cm')).toMatchObject({ value: 35, delta: null })
    expect(m.find((r) => r.field === 'chest_cm')).toMatchObject({ value: null, day: null })
  })
})
