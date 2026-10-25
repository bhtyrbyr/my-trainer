export type StreakTier = 'none' | 'low' | 'medium' | 'high' | 'legendary' | 'mythic'

/** Product rule: 1-4 low, 5-14 medium, 15-29 high, 30-44 legendary, 45+ mythic; 0 = no flame (ember). */
export function streakTier(days: number): StreakTier {
  if (!Number.isFinite(days) || days <= 0) return 'none'
  if (days < 5) return 'low'
  if (days < 15) return 'medium'
  if (days < 30) return 'high'
  if (days < 45) return 'legendary'
  return 'mythic'
}

/**
 * Streak that is still alive: the stored streak counts only if the user was active today or yesterday
 * (local calendar). Mirrors public.effective_streak() in SQL.
 */
export function effectiveStreak(current: number | null | undefined, lastActiveOn: string | null | undefined, today = new Date()): number {
  if (!current || !lastActiveOn) return 0
  const [y, m, d] = lastActiveOn.split('-').map(Number)
  const last = new Date(y!, (m ?? 1) - 1, d ?? 1)
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const diffDays = Math.round((start.getTime() - last.getTime()) / 86_400_000)
  return diffDays <= 1 ? current : 0
}

/** 0..1 progress through the current tier (mythic is always full, none is empty). */
export function tierProgress(days: number): number {
  const d = Math.max(0, Math.floor(days))
  const bands: [number, number][] = [[1, 5], [5, 15], [15, 30], [30, 45]]
  if (d < 1) return 0
  for (const [start, end] of bands) if (d < end) return (d - start + 1) / (end - start)
  return 1
}

/** Days remaining until the next tier, or null at the top tier. */
export function daysToNextTier(days: number): number | null {
  const d = Math.max(0, Math.floor(days))
  for (const boundary of [1, 5, 15, 30, 45]) if (d < boundary) return boundary - d
  return null
}
