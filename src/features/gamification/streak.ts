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

/** Days remaining until the next tier, or null at the top tier. */
export function daysToNextTier(days: number): number | null {
  const d = Math.max(0, Math.floor(days))
  for (const boundary of [1, 5, 15, 30, 45]) if (d < boundary) return boundary - d
  return null
}
