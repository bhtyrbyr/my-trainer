import { describe, expect, it } from 'vitest'
import { onboardingSchema, suggestUsername, USERNAME_RE } from './schema'

describe('username rules', () => {
  it('accepts lowercase letters, digits and underscore, 3-20 chars', () => {
    expect(USERNAME_RE.test('ali_1')).toBe(true)
    expect(USERNAME_RE.test('ab')).toBe(false)
    expect(USERNAME_RE.test('a'.repeat(21))).toBe(false)
    expect(USERNAME_RE.test('Ali')).toBe(false)
    expect(USERNAME_RE.test('ali-1')).toBe(false)
  })
  const base = { username: 'ali', displayName: 'Ali', showOnLeaderboard: true, sex: 'male', goal: 'maintain' }
  it('schema lower-cases and trims before validating', () => {
    const r = onboardingSchema.safeParse({ ...base, username: '  Ali_01 ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.username).toBe('ali_01')
  })
  it('rejects empty display name', () => {
    expect(onboardingSchema.safeParse({ ...base, displayName: '  ' }).success).toBe(false)
  })
  it('requires sex and goal, but not year/height/weight', () => {
    expect(onboardingSchema.safeParse({ ...base, sex: '' }).success).toBe(false)
    expect(onboardingSchema.safeParse({ ...base, goal: '' }).success).toBe(false)
    expect(onboardingSchema.safeParse({ ...base, birthYear: '', heightCm: '', weightKg: '' }).success).toBe(true)
  })
})

describe('suggestUsername', () => {
  it('transliterates Turkish characters and spaces', () => {
    expect(suggestUsername('Çağrı Şık', undefined)).toBe('cagri_sik')
  })
  it('falls back to the email local part', () => {
    expect(suggestUsername(undefined, 'john.doe@gmail.com')).toBe('john_doe')
  })
  it('always returns at least 3 characters', () => {
    expect(suggestUsername('A', undefined).length).toBeGreaterThanOrEqual(3)
  })
})
