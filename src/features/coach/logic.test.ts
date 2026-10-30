import { describe, expect, it } from 'vitest'
import { classifyError } from '@/lib/errors'
import { COACH_ANSWERED, MAX_INPUT, coachErrorCode, formatReply, isQuickPrompt, parseInline, sendable, titleFrom } from './logic'

describe('titleFrom', () => {
  it('keeps short questions as they are, on one line', () => {
    expect(titleFrom('  Yarın ne\n çalışayım?  ')).toBe('Yarın ne çalışayım?')
  })
  it('cuts long questions on a word boundary with an ellipsis', () => {
    const t = titleFrom('Haftamı değerlendirir misin? Neler iyi gitti, neyi geliştirebilirim? Gelecek hafta için hedef öner.')
    expect(t.length).toBeLessThanOrEqual(60)
    expect(t.endsWith('…')).toBe(true)
    expect(t).toBe('Haftamı değerlendirir misin? Neler iyi gitti, neyi…')
  })
  it('hard-cuts a single very long word', () => {
    const t = titleFrom('x'.repeat(200))
    expect(t).toHaveLength(60)
  })
})

describe('sendable', () => {
  it('trims and rejects empty or too long input', () => {
    expect(sendable('  hi  ')).toBe('hi')
    expect(sendable('   ')).toBeNull()
    expect(sendable('a'.repeat(MAX_INPUT + 1))).toBeNull()
    expect(sendable('a'.repeat(MAX_INPUT))).toHaveLength(MAX_INPUT)
  })
})

describe('isQuickPrompt', () => {
  it('accepts only known prompt keys (history state is untrusted)', () => {
    expect(isQuickPrompt('weekly')).toBe(true)
    expect(isQuickPrompt('protein')).toBe(true)
    expect(isQuickPrompt('drop table')).toBe(false)
    expect(isQuickPrompt(undefined)).toBe(false)
  })
})

describe('parseInline', () => {
  it('splits **bold** and __bold__ from plain text', () => {
    expect(parseInline('a **b** c __d__')).toEqual([
      { text: 'a ', bold: false },
      { text: 'b', bold: true },
      { text: ' c ', bold: false },
      { text: 'd', bold: true },
    ])
  })
  it('leaves unmatched markers and HTML as literal text', () => {
    expect(parseInline('2 ** 3 <b>x</b>')).toEqual([{ text: '2 ** 3 <b>x</b>', bold: false }])
  })
})

describe('formatReply', () => {
  it('builds paragraphs, bullet and numbered lists', () => {
    const blocks = formatReply('Good week.\nKeep going.\n\nWell:\n- chest\n* legs\n\n1. sleep\n2) protein')
    expect(blocks).toEqual([
      { kind: 'p', spans: [{ text: 'Good week. Keep going.', bold: false }] },
      { kind: 'p', spans: [{ text: 'Well:', bold: false }] },
      { kind: 'ul', items: [[{ text: 'chest', bold: false }], [{ text: 'legs', bold: false }]] },
      { kind: 'ol', items: [[{ text: 'sleep', bold: false }], [{ text: 'protein', bold: false }]] },
    ])
  })
  it('turns a markdown heading into a bold line', () => {
    expect(formatReply('## **Plan**\ntext')).toEqual([
      { kind: 'p', spans: [{ text: 'Plan', bold: true }] },
      { kind: 'p', spans: [{ text: 'text', bold: false }] },
    ])
  })
  it('returns nothing for blank text', () => {
    expect(formatReply(' \n\n ')).toEqual([])
  })
})

describe('coachErrorCode', () => {
  it('re-tags shared AI gate codes for coach wording', () => {
    expect(coachErrorCode(429, 'AI_QUOTA')).toBe('COACH_AI_QUOTA')
    expect(coachErrorCode(502, 'AI_UNAVAILABLE')).toBe('COACH_AI_UNAVAILABLE')
    expect(coachErrorCode(451, 'AI_REGION')).toBe('COACH_AI_REGION')
  })
  it('keeps codes that drive dedicated UI', () => {
    expect(coachErrorCode(403, 'AI_UNDERAGE')).toBe('AI_UNDERAGE')
    expect(coachErrorCode(403, 'AI_CONSENT_REQUIRED')).toBe('AI_CONSENT_REQUIRED')
    expect(coachErrorCode(429, 'AI_GOOGLE_MINUTE')).toBe('AI_GOOGLE_MINUTE')
  })
  it('treats a 409 bad input as already answered', () => {
    expect(coachErrorCode(409, 'AI_BAD_INPUT')).toBe(COACH_ANSWERED)
    expect(coachErrorCode(400, 'AI_BAD_INPUT')).toBe('AI_BAD_INPUT')
  })
  it('maps to coach messages in lib/errors', () => {
    expect(classifyError(new Error('COACH_AI_QUOTA')).key).toBe('errors.coachQuota')
    expect(classifyError(new Error('COACH_AI_UNAVAILABLE')).key).toBe('errors.coachUnavailable')
    expect(classifyError(new Error('COACH_AI_REGION')).key).toBe('errors.coachRegion')
    expect(classifyError(new Error('COACH_CONVERSATION_LIMIT')).key).toBe('errors.coachConversationLimit')
    expect(classifyError(new Error('COACH_MESSAGE_LIMIT')).key).toBe('errors.coachMessageLimit')
    expect(classifyError(new Error('AI_QUOTA')).key).toBe('errors.aiQuota')
  })
})
