import { describe, expect, it } from 'vitest'
import {
  compactCount,
  followAction,
  followLabel,
  formatReport,
  groupMonogram,
  inviteLink,
  nextCursor,
  notificationTarget,
  parseInviteCode,
  parseReport,
  socialEligibility,
} from './logic'

describe('nextCursor', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      created_at: `2026-11-01T10:${String(59 - i).padStart(2, '0')}:00Z`,
    }))
  it('returns the last created_at for a full page', () => {
    expect(nextCursor(rows(3), 3)).toBe('2026-11-01T10:57:00Z')
  })
  it('stops on a short page', () => {
    expect(nextCursor(rows(2), 3)).toBeUndefined()
    expect(nextCursor([], 3)).toBeUndefined()
  })
})

describe('socialEligibility', () => {
  const now = new Date('2026-11-01T12:00:00Z')
  it('needs a birth year', () => expect(socialEligibility(null, now)).toBe('birth_year_required'))
  it('refuses under 18 like the server (birth_year > year - 18)', () => {
    expect(socialEligibility(2009, now)).toBe('underage')
    expect(socialEligibility(2008, now)).toBe('ok')
    expect(socialEligibility(1990, now)).toBe('ok')
  })
})

describe('follow button', () => {
  it('maps relations to actions', () => {
    expect(followAction('none')).toBe('follow')
    expect(followAction('requested')).toBe('cancel')
    expect(followAction('following')).toBe('unfollow')
    expect(followAction('friends')).toBe('unfollow')
    expect(followAction('self')).toBe('none')
  })
  it('labels by relation, privacy and follow-back', () => {
    expect(followLabel('none', false, false)).toBe('follow')
    expect(followLabel('none', true, false)).toBe('request')
    expect(followLabel('none', true, true)).toBe('followBack')
    expect(followLabel('requested', true, false)).toBe('requested')
    expect(followLabel('friends', false, true)).toBe('friends')
  })
})

describe('notificationTarget', () => {
  const base = { actor_id: 'a', post_id: 'p', group_id: 'g' }
  it('links likes to the post, group kinds to the group, the rest to the actor', () => {
    expect(notificationTarget({ ...base, kind: 'like' })).toBe('/social/p/p')
    expect(notificationTarget({ ...base, kind: 'group_invite' })).toBe('/social/g/g')
    expect(notificationTarget({ ...base, kind: 'group_request' })).toBe('/social/g/g?view=members')
    expect(notificationTarget({ ...base, kind: 'follow_request' })).toBe('/social/u/a')
    expect(notificationTarget({ ...base, kind: 'like', post_id: null })).toBeNull()
    expect(notificationTarget({ ...base, kind: 'mention' })).toBe('/social/p/p')
    expect(notificationTarget({ ...base, kind: 'mention', post_id: null })).toBeNull()
  })
})

describe('reports', () => {
  it('round-trips reason and note', () => {
    expect(formatReport('spam')).toBe('spam')
    const s = formatReport('harassment', '  rude \n comments ')
    expect(s).toBe('harassment: rude comments')
    expect(parseReport(s)).toEqual({ reason: 'harassment', note: 'rude comments' })
  })
  it('caps at 300 chars and treats unknown text as a note', () => {
    expect(formatReport('other', 'x'.repeat(400))).toHaveLength(300)
    expect(parseReport('free text')).toEqual({ reason: null, note: 'free text' })
  })
})

describe('misc', () => {
  it('builds invite links without double slashes', () => {
    expect(inviteLink('https://a.app/', 'ABCDEFGH23')).toBe('https://a.app/social/join/ABCDEFGH23')
  })
  it('compacts large counts only', () => {
    expect(compactCount(9999, 'en')).toBe('9,999')
    expect(compactCount(12_300, 'en')).toBe('12.3K')
  })
})

describe('groupMonogram', () => {
  it('takes the first letters of two words, Turkish upper case', () => {
    expect(groupMonogram('Kadıköy Barbell')).toBe('KB')
    expect(groupMonogram('istanbul ıhlamur koşucuları')).toBe('İI')
    expect(groupMonogram('5x5 Disiplini')).toBe('5D')
    expect(groupMonogram('  powerlifting  ')).toBe('P')
    expect(groupMonogram('iron crew', 'en')).toBe('IC')
  })
  it('falls back to ? for an empty name', () => {
    expect(groupMonogram('')).toBe('?')
    expect(groupMonogram(null)).toBe('?')
  })
})

describe('parseInviteCode', () => {
  it('accepts a bare code or a pasted invite link', () => {
    expect(parseInviteCode('  k7xq2mpa9r ')).toBe('K7XQ2MPA9R')
    expect(parseInviteCode('https://a.app/social/join/K7XQ2MPA9R')).toBe('K7XQ2MPA9R')
    expect(parseInviteCode('Katıl: https://a.app/social/join/abcDEF2345?x=1')).toBe('ABCDEF2345')
  })
  it('rejects anything that is not a code', () => {
    expect(parseInviteCode('')).toBe('')
    expect(parseInviteCode('ab')).toBe('')
    expect(parseInviteCode('hello world')).toBe('')
    expect(parseInviteCode('../etc')).toBe('')
  })
})
