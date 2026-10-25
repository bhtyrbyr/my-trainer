import { describe, expect, it } from 'vitest'
import { toLocalDateISO } from './dates'

describe('toLocalDateISO', () => {
  it('uses the local calendar date, not UTC', () => {
    // 23:30 local on 2026-10-25. In UTC+3 this is 20:30Z same day; the point is we format local fields.
    const d = new Date(2026, 9, 25, 23, 30)
    expect(toLocalDateISO(d)).toBe('2026-10-25')
  })
  it('zero-pads month and day', () => {
    expect(toLocalDateISO(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
