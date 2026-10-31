// Tests for the ai-coach Edge Function's pure helpers (supabase/functions/ai-coach/coach.ts).
import { describe, expect, it } from 'vitest'
import {
  COACH_CONTEXT_CHARS,
  COACH_HISTORY_MESSAGES,
  COACH_MAX_OUTPUT_TOKENS,
  COACH_REPLY_CHARS,
  buildCoachSystemPrompt,
  cleanReply,
  coachModelOrder,
  compactContext,
  istanbulDay,
  signCoachReply,
  trimHistory,
  type ChatMessage,
} from '../../../supabase/functions/ai-coach/coach'

const u = (content: string): ChatMessage => ({ role: 'user', content })
const a = (content: string): ChatMessage => ({ role: 'assistant', content })

describe('coachModelOrder', () => {
  it('puts Flash Lite first and keeps the rest in the configured order', () => {
    expect(coachModelOrder(['gemini-3.8-flash', 'gemini-3.5-flash-lite'])).toEqual(['gemini-3.5-flash-lite', 'gemini-3.8-flash'])
    expect(coachModelOrder(['a', 'x-lite', 'b', 'y-Lite'])).toEqual(['x-lite', 'y-Lite', 'a', 'b'])
  })
  it('drops duplicates and blanks', () => {
    expect(coachModelOrder(['m', 'm', ' ', 'm-lite'])).toEqual(['m-lite', 'm'])
  })
})

describe('trimHistory', () => {
  it('keeps at most the newest 12 messages and starts with a user turn', () => {
    const msgs: ChatMessage[] = []
    for (let i = 0; i < 20; i++) msgs.push(u(`q${i}`), a(`r${i}`))
    msgs.push(u('last'))
    const h = trimHistory(msgs)
    expect(h.length).toBeLessThanOrEqual(COACH_HISTORY_MESSAGES)
    expect(h[0].role).toBe('user')
    expect(h[h.length - 1]).toEqual(u('last'))
  })
  it('returns nothing when the newest message is already a reply', () => {
    expect(trimHistory([u('q'), a('r')])).toEqual([])
    expect(trimHistory([])).toEqual([])
  })
  it('merges consecutive turns of one role (an unanswered question, then another)', () => {
    expect(trimHistory([u('one'), a('r'), u('two'), u('three')])).toEqual([u('one'), a('r'), u('two\n\nthree')])
  })
  it('clips long messages and respects the total budget, always keeping the newest', () => {
    const h = trimHistory([u('x'.repeat(5000)), a('y'.repeat(5000)), u('z'.repeat(5000))], { perMessage: 100, total: 150 })
    expect(h).toHaveLength(1)
    expect(h[0].content).toHaveLength(100)
    expect(h[0].content.endsWith('…')).toBe(true)
  })
  it('ignores blank and unknown-role rows', () => {
    expect(trimHistory([u('  '), { role: 'system' as 'user', content: 'x' }, u('q')])).toEqual([u('q')])
  })
})

describe('compactContext', () => {
  it('never forwards health data (weight, sleep, nutrition, water)', () => {
    const json = compactContext({
      health_consent: true,
      weight: { latest_kg: 80 },
      sleep: { avg_minutes: 420 },
      nutrition: { avg_kcal: 2100 },
      this_week: { workouts: 3, avg_sleep_minutes: 400, weight_change_kg: -0.5, water_goal_days: 4 },
    })
    expect(json).toBe('{"this_week":{"workouts":3}}')
  })

  it('removes identifying keys, nulls and empty lists, and rounds numbers', () => {
    const json = compactContext({
      user_id: 'u-1',
      email: 'a@b.c',
      name: 'Ali',
      workouts: { sessions: 3, volume_kg: 9240.123456, last_session_on: '2026-10-30', id: 'x' },
      records: [],
      weight: null,
      body_parts: [{ body_part: 'chest', sets: 12 }],
    })
    const parsed = JSON.parse(json)
    expect(parsed).toEqual({ workouts: { sessions: 3, volume_kg: 9240.12, last_session_on: '2026-10-30' }, body_parts: [{ body_part: 'chest', sets: 12 }] })
    expect(json).not.toMatch(/Ali|a@b\.c|u-1/)
  })
  it('keeps record exercise names (catalog names, not people)', () => {
    expect(JSON.parse(compactContext({ records: [{ exercise: 'Bench Press', e1rm: 100 }] }))).toEqual({ records: [{ exercise: 'Bench Press', e1rm: 100 }] })
  })
  it('is bounded in size', () => {
    const big = { list: Array.from({ length: 2000 }, (_, i) => ({ body_part: `part${i}`, sets: i })) }
    expect(compactContext(big).length).toBeLessThanOrEqual(COACH_CONTEXT_CHARS)
  })
  it('handles nothing', () => {
    expect(compactContext(null)).toBe('{}')
  })
})

describe('istanbulDay', () => {
  it('uses the Istanbul calendar day (UTC+3)', () => {
    expect(istanbulDay(new Date('2026-10-31T22:30:00Z'))).toEqual({ date: '2026-11-01', weekday: 'Sunday' })
    expect(istanbulDay(new Date('2026-10-31T20:00:00Z'))).toEqual({ date: '2026-10-31', weekday: 'Saturday' })
  })
})

describe('buildCoachSystemPrompt', () => {
  const now = new Date('2026-10-31T09:00:00Z')
  it('sets the reply language by locale', () => {
    expect(buildCoachSystemPrompt({ locale: 'tr', context: '{}', now })).toMatch(/reply in Turkish/)
    expect(buildCoachSystemPrompt({ locale: 'en', context: '{}', now })).toMatch(/reply in English/)
  })
  it('states the safety rules and the context-only rule', () => {
    const p = buildCoachSystemPrompt({ locale: 'tr', context: '{"streak":4}', now })
    expect(p).toMatch(/never medical advice/)
    expect(p).toMatch(/doctor or physiotherapist/)
    expect(p).toMatch(/only on CONTEXT/)
    expect(p).toMatch(/never invent numbers/)
    expect(p).toContain('Today is Saturday, 2026-10-31.')
    expect(p.endsWith('CONTEXT: {"streak":4}')).toBe(true)
  })
  it('mentions pounds only for lb users and stays short', () => {
    expect(buildCoachSystemPrompt({ locale: 'en', context: null, now, unit: 'lb' })).toMatch(/prefers pounds/)
    expect(buildCoachSystemPrompt({ locale: 'en', context: null, now })).not.toMatch(/pounds/)
    expect(buildCoachSystemPrompt({ locale: 'en', context: null, now }).length).toBeLessThan(2500)
  })
  it('keeps the output budget at 600 tokens', () => {
    expect(COACH_MAX_OUTPUT_TOKENS).toBe(600)
  })
})

describe('cleanReply', () => {
  it('drops control characters, normalises newlines and trims', () => {
    expect(cleanReply('\u0000 Hi\r\n\r\n\r\n\r\nthere\u0007 ')).toBe('Hi\n\nthere')
  })
  it('caps the length to what the database stores', () => {
    const r = cleanReply('a'.repeat(COACH_REPLY_CHARS + 50))
    expect(r).toHaveLength(COACH_REPLY_CHARS)
  })
})

describe('signCoachReply', () => {
  it('matches the SQL check (hmac of "<id>:<content>" with the derived key)', async () => {
    // reference computed with pgcrypto: encode(hmac(id||':'||content, encode(hmac('coach-reply-v1', secret, 'sha256'), 'hex'), 'sha256'), 'hex')
    const sig = await signCoachReply('coach-test-secret', '00000000-0000-0000-0000-000000000541', 'Harika')
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
    expect(sig).toBe('84ae3011a3f4964ad48b06018d1c99c8ce43662f00c8f6f8aaabf65a9b5eb0af')
    expect(await signCoachReply('coach-test-secret', '00000000-0000-0000-0000-000000000541', 'Harika!')).not.toBe(sig)
  })
})
