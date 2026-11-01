/**
 * Badge catalog as the client knows it (mirrors public.badges, 20261130000000_more_badges.sql; the metric
 * names are the keys my_badge_progress() returns). Names and descriptions live in i18n
 * (badges:items.<code>.*); the server decides who earned what.
 */
export const BADGES = [
  { code: 'first_workout', threshold: 1, metric: 'workouts' },
  { code: 'workouts_10', threshold: 10, metric: 'workouts' },
  { code: 'workouts_50', threshold: 50, metric: 'workouts' },
  { code: 'workouts_100', threshold: 100, metric: 'workouts' },
  { code: 'workouts_250', threshold: 250, metric: 'workouts' },
  { code: 'streak_7', threshold: 7, metric: 'streak' },
  { code: 'streak_30', threshold: 30, metric: 'streak' },
  { code: 'streak_100', threshold: 100, metric: 'streak' },
  { code: 'streak_365', threshold: 365, metric: 'streak' },
  { code: 'sets_100', threshold: 100, metric: 'sets' },
  { code: 'sets_500', threshold: 500, metric: 'sets' },
  { code: 'sets_1000', threshold: 1000, metric: 'sets' },
  { code: 'sets_5000', threshold: 5000, metric: 'sets' },
  { code: 'volume_10t', threshold: 10000, metric: 'volume_kg' },
  { code: 'volume_100t', threshold: 100000, metric: 'volume_kg' },
  { code: 'volume_1000t', threshold: 1000000, metric: 'volume_kg' },
  { code: 'pr_10', threshold: 10, metric: 'prs' },
  { code: 'pr_50', threshold: 50, metric: 'prs' },
  { code: 'cardio_600', threshold: 600, metric: 'cardio_minutes' },
  { code: 'cardio_3000', threshold: 3000, metric: 'cardio_minutes' },
  { code: 'early_bird_5', threshold: 5, metric: 'early_workouts' },
  { code: 'weekend_10', threshold: 10, metric: 'weekend_workouts' },
  { code: 'habit_30', threshold: 30, metric: 'habit_days' },
  { code: 'habit_100', threshold: 100, metric: 'habit_days' },
  { code: 'habit_365', threshold: 365, metric: 'habit_days' },
  { code: 'todo_50', threshold: 50, metric: 'todos' },
  { code: 'todo_200', threshold: 200, metric: 'todos' },
  { code: 'water_30', threshold: 30, metric: 'water_goal_days' },
  { code: 'sleep_30', threshold: 30, metric: 'sleep_logs' },
  { code: 'weigh_30', threshold: 30, metric: 'weigh_ins' },
  { code: 'photos_10', threshold: 10, metric: 'photos' },
  { code: 'photos_25', threshold: 25, metric: 'photos' },
] as const

export type BadgeCode = (typeof BADGES)[number]['code']
export type BadgeMetric = (typeof BADGES)[number]['metric']
/** Running totals that move the badges (own data only; see api.fetchBadgeCounts). */
export type BadgeCounts = Record<BadgeMetric, number>
/** Families in shelf order (one per metric), for the grouped full grid. */
export const BADGE_FAMILIES = [...new Set(BADGES.map((b) => b.metric))] as BadgeMetric[]

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
