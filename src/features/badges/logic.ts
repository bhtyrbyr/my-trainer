/**
 * Badge catalog as the client knows it (mirrors public.badges, 20261106000000_badges.sql). Names and
 * descriptions live in i18n (badges:items.<code>.*); the server decides who earned what.
 */
export const BADGES = [
  { code: 'first_workout', threshold: 1, metric: 'workouts' },
  { code: 'streak_7', threshold: 7, metric: 'streak' },
  { code: 'streak_30', threshold: 30, metric: 'streak' },
  { code: 'sets_100', threshold: 100, metric: 'sets' },
  { code: 'photos_10', threshold: 10, metric: 'photos' },
  { code: 'habit_30', threshold: 30, metric: 'habitDays' },
  { code: 'todo_50', threshold: 50, metric: 'todos' },
] as const

export type BadgeCode = (typeof BADGES)[number]['code']
export type BadgeMetric = (typeof BADGES)[number]['metric']
/** Running totals that move the badges (own data only; see api.fetchBadgeCounts). */
export type BadgeCounts = Record<BadgeMetric, number>
export type EarnedBadge = { badge_code: string; earned_at: string }

export type ShelfItem = {
  code: BadgeCode
  earnedAt: string | null
  /** progress towards a locked badge (null when unknown, e.g. someone else's shelf) */
  progress: { value: number; threshold: number; ratio: number } | null
}

export function isBadgeCode(code: string): code is BadgeCode {
  return BADGES.some((b) => b.code === code)
}

/** Every catalog badge in shelf order, earned ones dated, locked ones with progress when counts are known. */
export function shelfItems(earned: readonly EarnedBadge[], counts?: BadgeCounts | null): ShelfItem[] {
  const at = new Map(earned.map((e) => [e.badge_code, e.earned_at]))
  return BADGES.map((b) => {
    const earnedAt = at.get(b.code) ?? null
    if (earnedAt || !counts) return { code: b.code, earnedAt, progress: null }
    const value = Math.max(0, Math.min(counts[b.metric] ?? 0, b.threshold))
    return { code: b.code, earnedAt, progress: { value, threshold: b.threshold, ratio: value / b.threshold } }
  })
}

// -----------------------------------------------------------------------------
// Celebration: each newly earned badge is shown once per device (localStorage)
// -----------------------------------------------------------------------------

function parseSeen(raw: string | null): Set<string> | null {
  if (raw === null) return null
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? new Set(v.filter((x): x is string => typeof x === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

/**
 * Which earned badges still need a celebration, and the value to store once they are shown.
 * First run on a device (nothing stored): everything already earned becomes the silent baseline, so
 * a returning user is not flooded with old milestones.
 */
export function celebrationQueue(
  earnedCodes: readonly string[],
  seenRaw: string | null,
): { show: BadgeCode[]; seen: string } {
  const known = earnedCodes.filter(isBadgeCode)
  const seen = parseSeen(seenRaw)
  if (seen === null) return { show: [], seen: JSON.stringify(known) }
  const show = BADGES.map((b) => b.code).filter((c) => known.includes(c) && !seen.has(c))
  return { show, seen: JSON.stringify([...new Set([...seen, ...known])]) }
}
