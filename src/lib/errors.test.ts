import { describe, expect, it } from 'vitest'
import { classifyError } from './errors'

describe('classifyError', () => {
  it('maps RLS denial to forbidden', () => {
    expect(classifyError({ code: '42501', message: 'new row violates row-level security policy' }).key).toBe('errors.forbidden')
  })
  it('maps unique violations with the column', () => {
    const r = classifyError({ code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_key" Key (username)=(x) already exists.' })
    expect(r.key).toBe('errors.duplicate')
    expect(r.detail).toBe('username')
  })
  it('maps custom SQL exceptions', () => {
    expect(classifyError(new Error('USERNAME_COOLDOWN')).key).toBe('errors.usernameCooldown')
    expect(classifyError({ message: 'ACCESS_DENIED: x is not on the invite list' }).key).toBe('errors.accessDenied')
  })
  it('maps HTTP statuses', () => {
    expect(classifyError({ status: 429, message: 'Too many requests' }).key).toBe('errors.rateLimited')
    expect(classifyError({ status: 503, message: 'Service unavailable' }).key).toBe('errors.server')
  })
  it('falls back to unknown with a trimmed detail', () => {
    const r = classifyError({ message: 'something odd' })
    expect(r.key).toBe('errors.unknown')
    expect(r.detail).toBe('something odd')
  })
  it('never prints [object Object]', () => {
    expect(classifyError({ foo: 1 }).detail).toBeUndefined()
  })
})
