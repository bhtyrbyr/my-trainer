import { describe, expect, it } from 'vitest'
import { activeMentionQuery, insertMention, keepWritten, readMentions, splitPostText, writtenMentions } from './mentions'

const ali = { user_id: 'u-ali', username: 'ali_k', display_name: 'Ali Kaya' }
const ece = { user_id: 'u-ece', username: 'ece', display_name: 'Ece' }

describe('splitPostText', () => {
  it('links listed mentions and keeps the text intact', () => {
    const s = 'Squat with @ali_k and @ECE today'
    const parts = splitPostText(s, [ali, ece])
    expect(parts.map((p) => p.text).join('')).toBe(s)
    expect(parts).toEqual([
      { type: 'text', text: 'Squat with ' },
      { type: 'mention', text: '@ali_k', userId: 'u-ali', username: 'ali_k' },
      { type: 'text', text: ' and ' },
      { type: 'mention', text: '@ECE', userId: 'u-ece', username: 'ece' },
      { type: 'text', text: ' today' },
    ])
  })

  it('leaves unlisted @text plain and merges it with the surrounding text', () => {
    expect(splitPostText('hi @someone else', [ali])).toEqual([{ type: 'text', text: 'hi @someone else' }])
    expect(splitPostText('hi @ali_k', [])).toEqual([{ type: 'text', text: 'hi @ali_k' }])
  })

  it('combines hashtags and mentions in one pass', () => {
    const s = '#LegDay with @ali_k, then #PR (@ece)'
    const parts = splitPostText(s, [ali, ece])
    expect(parts.map((p) => p.text).join('')).toBe(s)
    expect(parts.map((p) => p.type)).toEqual(['tag', 'text', 'mention', 'text', 'tag', 'text', 'mention', 'text'])
    expect(parts[0]).toEqual({ type: 'tag', text: '#LegDay', tag: 'legday' })
  })

  it('ignores e-mail addresses, glued tokens and longer runs', () => {
    const plain = (s: string) => splitPostText(s, [ali, ece]).every((p) => p.type !== 'mention')
    expect(plain('mail me at x@ece')).toBe(true)
    expect(plain('a.@ece')).toBe(true)
    expect(plain('@@ece')).toBe(true)
    expect(plain('#leg@ece')).toBe(true)
    expect(plain('@ecel')).toBe(true)
    expect(plain('@eceş')).toBe(true)
  })

  it('links at the start, end and next to punctuation and newlines', () => {
    const mentions = (s: string) => splitPostText(s, [ali, ece]).filter((p) => p.type === 'mention').map((p) => p.text)
    expect(mentions('@ece')).toEqual(['@ece'])
    expect(mentions('thanks @ece.')).toEqual(['@ece'])
    expect(mentions('line\n@ali_k!')).toEqual(['@ali_k'])
    expect(mentions('@ece @ece')).toEqual(['@ece', '@ece'])
  })

  it('returns an empty list for empty text', () => {
    expect(splitPostText('', [ali])).toEqual([])
  })
})

describe('writtenMentions / keepWritten', () => {
  it('collects every written token, lower-cased', () => {
    expect([...writtenMentions('@Ali_K hi @ece and x@nope @ab')]).toEqual(['ali_k', 'ece'])
  })
  it('drops picked people whose token was deleted from the text', () => {
    expect(keepWritten([ali, ece], 'only @ece left')).toEqual([ece])
    expect(keepWritten([ali, ece], '@ali_kx')).toEqual([])
  })
})

describe('activeMentionQuery', () => {
  it('finds the word being typed after @', () => {
    expect(activeMentionQuery('hi @al', 6)).toEqual({ start: 3, end: 6, query: 'al' })
    expect(activeMentionQuery('@', 1)).toEqual({ start: 0, end: 1, query: '' })
    expect(activeMentionQuery('hi @Çağ', 7)).toEqual({ start: 3, end: 7, query: 'Çağ' })
  })
  it('covers the rest of the word after the caret', () => {
    expect(activeMentionQuery('hi @alxy there', 6)).toEqual({ start: 3, end: 8, query: 'al' })
  })
  it('is null outside a mention', () => {
    expect(activeMentionQuery('hi @al there', 12)).toBeNull()
    expect(activeMentionQuery('mail x@al', 9)).toBeNull()
    expect(activeMentionQuery('no at sign', 5)).toBeNull()
  })
})

describe('insertMention', () => {
  it('replaces the typed query with @username and a space', () => {
    const q = activeMentionQuery('hi @al', 6)!
    expect(insertMention('hi @al', q, 'ali_k')).toEqual({ text: 'hi @ali_k ', caret: 10 })
  })
  it('does not double the space and keeps the rest of the text', () => {
    const q = activeMentionQuery('hi @al there', 6)!
    expect(insertMention('hi @al there', q, 'ali_k')).toEqual({ text: 'hi @ali_k there', caret: 10 })
  })
  it('refuses to grow past the limit', () => {
    const q = activeMentionQuery('@a', 2)!
    expect(insertMention('@a', q, 'ali_k', 5)).toBeNull()
  })
})

describe('readMentions', () => {
  it('keeps well-formed rows only', () => {
    expect(readMentions([ali, { user_id: 1 }, null, { user_id: 'x', username: 'xy' }])).toEqual([
      ali,
      { user_id: 'x', username: 'xy', display_name: 'xy' },
    ])
    expect(readMentions(null)).toEqual([])
  })
})
