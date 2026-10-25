import { describe, expect, it } from 'vitest'
import { averageMinutes, minutesBetween, nightWindow, sleepWeek, splitDuration, waterTotal } from './logic'

describe('sleep helpers', () => {
  it('splits minutes', () => {
    expect(splitDuration(465)).toEqual({ h: 7, m: 45 })
    expect(splitDuration(-5)).toEqual({ h: 0, m: 0 })
  })
  it('puts a late bedtime on the previous evening', () => {
    const { bedAt, wakeAt } = nightWindow('2026-10-26', '23:30', '07:15')
    expect(minutesBetween(bedAt, wakeAt)).toBe(465)
    expect(bedAt.getDate()).toBe(25)
  })
  it('keeps an after-midnight bedtime on the same day', () => {
    const { bedAt, wakeAt } = nightWindow('2026-10-26', '01:00', '08:00')
    expect(minutesBetween(bedAt, wakeAt)).toBe(420)
  })
  it('builds a 7-night week with gaps and its average', () => {
    const week = sleepWeek(
      [
        { sleep_on: '2026-10-26', duration_min: 480 },
        { sleep_on: '2026-10-24', duration_min: 360 },
      ],
      '2026-10-26',
    )
    expect(week).toHaveLength(7)
    expect(week[6]).toEqual({ day: '2026-10-26', minutes: 480 })
    expect(week[5].minutes).toBeNull()
    expect(averageMinutes(week)).toBe(420)
    expect(averageMinutes([{ minutes: null }])).toBeNull()
  })
})

describe('water', () => {
  it('sums the day', () => {
    expect(waterTotal([{ amount_ml: 250 }, { amount_ml: 500 }])).toBe(750)
  })
})
