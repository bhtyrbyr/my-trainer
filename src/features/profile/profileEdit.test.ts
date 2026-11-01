import { describe, expect, it } from 'vitest'
import { isMinorBirthYear, nextUsernameChange, profileEditSchema } from './schema'

describe('nextUsernameChange', () => {
  const now = new Date('2026-11-01T12:00:00Z')
  it('allows a change when the username was never changed', () => {
    expect(nextUsernameChange(null, now)).toBeNull()
    expect(nextUsernameChange(undefined, now)).toBeNull()
  })
  it('returns the date 30 days after the last change while it is in the future', () => {
    expect(nextUsernameChange('2026-10-20T12:00:00Z', now)?.toISOString()).toBe('2026-11-19T12:00:00.000Z')
  })
  it('allows a change once 30 days have passed', () => {
    expect(nextUsernameChange('2026-10-02T12:00:00Z', now)).toBeNull()
    expect(nextUsernameChange('2026-09-01T00:00:00Z', now)).toBeNull()
  })
})

describe('isMinorBirthYear', () => {
  const now = new Date('2026-11-01T12:00:00Z')
  it('matches the server gate: birth year after current year - 18', () => {
    expect(isMinorBirthYear(2009, now)).toBe(true)
    expect(isMinorBirthYear(2008, now)).toBe(false)
    expect(isMinorBirthYear(1990, now)).toBe(false)
  })
  it('treats an unknown year as not a minor', () => {
    expect(isMinorBirthYear('', now)).toBe(false)
    expect(isMinorBirthYear(null, now)).toBe(false)
    expect(isMinorBirthYear(Number.NaN, now)).toBe(false)
  })
})

describe('profileEditSchema', () => {
  const base = { username: 'ali', displayName: 'Ali', sex: 'male', goal: 'maintain', birthYear: '', heightCm: '', targetWeightKg: '' }
  it('accepts a valid edit and coerces numbers', () => {
    const r = profileEditSchema.safeParse({ ...base, heightCm: '178.5', targetWeightKg: '75', birthYear: '1990' })
    expect(r.success).toBe(true)
    if (r.success) expect([r.data.heightCm, r.data.targetWeightKg, r.data.birthYear]).toEqual([178.5, 75, 1990])
  })
  it('rejects out-of-range target weight and a cleared sex', () => {
    expect(profileEditSchema.safeParse({ ...base, targetWeightKg: '10' }).success).toBe(false)
    expect(profileEditSchema.safeParse({ ...base, sex: '' }).success).toBe(false)
  })
})
