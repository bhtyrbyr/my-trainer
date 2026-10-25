export type StreakTier = 'none' | 'low' | 'medium' | 'high' | 'legendary'

/** Product rule: 1-4 low, 5-14 medium, 15-29 high, 30+ legendary; 0 = no flame (ember). */
export function streakTier(days: number): StreakTier {
  if (!Number.isFinite(days) || days <= 0) return 'none'
  if (days < 5) return 'low'
  if (days < 15) return 'medium'
  if (days < 30) return 'high'
  return 'legendary'
}

/** Days remaining until the next tier, or null at legendary. */
export function daysToNextTier(days: number): number | null {
  const d = Math.max(0, Math.floor(days))
  if (d < 1) return 1 - d
  if (d < 5) return 5 - d
  if (d < 15) return 15 - d
  if (d < 30) return 30 - d
  return null
}
