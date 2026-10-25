import { describe, expect, it } from 'vitest'
import { describeUrl, sanitizeBody } from './requestTrace'

describe('request trace privacy', () => {
  it('redacts secret-looking fields', () => {
    const out = sanitizeBody('{"email":"a@b.c","password":"hunter2","refresh_token":"abc","name":"Yulaf"}')
    expect(out).toContain('"password":"[redacted]"')
    expect(out).toContain('"refresh_token":"[redacted]"')
    expect(out).toContain('"name":"Yulaf"')
    expect(out).not.toContain('hunter2')
  })
  it('drops long base64 payloads such as photos', () => {
    const out = sanitizeBody(`{"image":{"data":"${'A'.repeat(5000)}"}}`)
    expect(out).toContain('[data omitted]')
    expect(out!.length).toBeLessThan(200)
  })
  it('keeps only path and query, and flags auth endpoints', () => {
    expect(describeUrl('https://x.supabase.co/rest/v1/meal_entries?eaten_on=eq.2026-10-26')).toEqual({ path: '/rest/v1/meal_entries?eaten_on=eq.2026-10-26', isAuth: false })
    expect(describeUrl('https://x.supabase.co/auth/v1/token?grant_type=refresh_token').isAuth).toBe(true)
  })
})
