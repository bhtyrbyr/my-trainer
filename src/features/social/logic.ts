import type { Relation } from './schema'

export const PAGE_SIZE = 20

/** Keyset cursor for the next page: the last row's created_at, or undefined when the page was short. */
export function nextCursor<T extends { created_at: string | null }>(
  page: readonly T[],
  limit = PAGE_SIZE,
): string | undefined {
  if (page.length < limit) return undefined
  return page[page.length - 1]?.created_at ?? undefined
}

export type Eligibility = 'ok' | 'underage' | 'birth_year_required'

/** Same rule as social_enable: a stored birth year and birth_year <= current year - 18. */
export function socialEligibility(birthYear: number | null | undefined, now: Date = new Date()): Eligibility {
  if (birthYear == null) return 'birth_year_required'
  return birthYear > now.getFullYear() - 18 ? 'underage' : 'ok'
}

export type FollowAction = 'follow' | 'cancel' | 'unfollow' | 'none'

/** What tapping the follow button does for a relation (self shows no button). */
export function followAction(relation: Relation | string | null | undefined): FollowAction {
  switch (relation) {
    case 'none':
      return 'follow'
    case 'requested':
      return 'cancel'
    case 'following':
    case 'friends':
      return 'unfollow'
    default:
      return 'none'
  }
}

/** Follow-button label key (social:follow.*) for a relation, the target's privacy and follow-back. */
export function followLabel(
  relation: Relation | string | null | undefined,
  isPrivate: boolean,
  followsMe: boolean,
): string {
  switch (relation) {
    case 'friends':
      return 'friends'
    case 'following':
      return 'following'
    case 'requested':
      return 'requested'
    default:
      if (followsMe) return 'followBack'
      return isPrivate ? 'request' : 'follow'
  }
}

type NotificationLike = {
  kind: string | null
  actor_id: string | null
  post_id: string | null
  group_id: string | null
}

/** Deep link of a notification: the post, the group, or the actor's profile. */
export function notificationTarget(n: NotificationLike): string | null {
  switch (n.kind) {
    case 'like':
      return n.post_id ? `/social/p/${n.post_id}` : null
    case 'group_invite':
    case 'group_accepted':
      return n.group_id ? `/social/g/${n.group_id}` : null
    case 'group_request':
      return n.group_id ? `/social/g/${n.group_id}?view=members` : null
    default:
      return n.actor_id ? `/social/u/${n.actor_id}` : null
  }
}

export function inviteLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/social/join/${encodeURIComponent(code)}`
}

export const REPORT_REASONS = ['spam', 'harassment', 'nudity', 'violence', 'hate', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

/** Stored report text: the reason code, optionally followed by the reporter's note (<= 300 chars total). */
export function formatReport(reason: ReportReason, note?: string): string {
  const extra = note?.trim().replace(/\s+/g, ' ')
  return (extra ? `${reason}: ${extra}` : reason).slice(0, 300)
}

export function parseReport(text: string | null | undefined): { reason: ReportReason | null; note: string } {
  const s = (text ?? '').trim()
  const m = /^([a-z]+)(?::\s*([\s\S]*))?$/.exec(s)
  const code = m?.[1]
  if (code && (REPORT_REASONS as readonly string[]).includes(code))
    return { reason: code as ReportReason, note: m?.[2]?.trim() ?? '' }
  return { reason: null, note: s }
}

/** Header counts: plain below 10 000, compact above. */
export function compactCount(n: number, locale: string): string {
  if (n < 10_000) return new Intl.NumberFormat(locale).format(n)
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** Group monogram for the rail: first letters of the first two words (one for a one-word name). */
export function groupMonogram(name: string | null | undefined, locale = 'tr'): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? '')
  return letters.join('').toLocaleUpperCase(locale) || '?'
}

/** The code from what someone typed or pasted: a bare code or a whole invite link; '' when nothing usable. */
export function parseInviteCode(input: string): string {
  const s = input.trim()
  const fromLink = /\/social\/join\/([^/?#\s]+)/.exec(s)?.[1]
  let code = s
  if (fromLink) {
    try {
      code = decodeURIComponent(fromLink)
    } catch {
      code = fromLink
    }
  }
  return /^[A-Za-z0-9]{4,32}$/.test(code) ? code.toUpperCase() : ''
}
