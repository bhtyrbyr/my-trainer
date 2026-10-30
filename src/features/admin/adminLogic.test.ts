import { describe, expect, it } from 'vitest'
import { CONFIG_DEFAULTS, normalizeEmail, parseAdminConfig, parseLimit } from './adminLogic'

describe('parseAdminConfig', () => {
  it('reads the three keys', () => {
    expect(
      parseAdminConfig([
        { key: 'access_mode', value: 'invite' },
        { key: 'require_approval', value: false },
        { key: 'ai_global_daily_limit', value: 350 },
      ]),
    ).toEqual({ access_mode: 'invite', require_approval: false, ai_global_daily_limit: 350 })
  })
  it('falls back to the server defaults for missing or odd values', () => {
    expect(parseAdminConfig([])).toEqual(CONFIG_DEFAULTS)
    expect(
      parseAdminConfig([
        { key: 'access_mode', value: 'closed' },
        { key: 'ai_global_daily_limit', value: -3 },
      ]),
    ).toEqual(CONFIG_DEFAULTS)
    expect(
      parseAdminConfig([
        { key: 'require_approval', value: 'false' },
        { key: 'ai_global_daily_limit', value: '120' },
      ]),
    ).toMatchObject({
      require_approval: false,
      ai_global_daily_limit: 120,
    })
  })
})

describe('normalizeEmail', () => {
  it('trims and lowercases valid addresses', () => {
    expect(normalizeEmail('  Ayse.Yilmaz@Example.COM ')).toBe('ayse.yilmaz@example.com')
  })
  it('rejects what the server rejects', () => {
    for (const bad of [
      '',
      'ayse',
      'ayse@',
      'ayse@example',
      'a b@example.com',
      '@example.com',
      `${'a'.repeat(250)}@x.co`,
    ]) {
      expect(normalizeEmail(bad)).toBeNull()
    }
  })
})

describe('parseLimit', () => {
  it('accepts whole numbers in range', () => {
    expect(parseLimit('0', 1000)).toBe(0)
    expect(parseLimit(' 40 ', 1000)).toBe(40)
    expect(parseLimit('1000', 1000)).toBe(1000)
  })
  it('rejects decimals, negatives, text and out-of-range values', () => {
    for (const bad of ['', '1001', '-1', '2.5', '4,5', 'abc']) expect(parseLimit(bad, 1000)).toBeNull()
  })
})
