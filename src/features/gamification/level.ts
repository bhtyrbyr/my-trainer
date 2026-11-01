/** Points per level: level = floor(points / 1000) + 1 (the same rule the database uses for profiles.level). */
export const POINTS_PER_LEVEL = 1000

export type LevelProgress = {
  level: number
  /** points earned inside the current level, 0..POINTS_PER_LEVEL-1 */
  into: number
  /** points still needed for the next level, 1..POINTS_PER_LEVEL */
  toNext: number
  /** progress through the current level, 0..1 (exclusive) */
  ratio: number
}

/** Level and progress to the next one for a points total (negative or fractional totals are clamped). */
export function levelProgress(points: number): LevelProgress {
  const p = Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0
  const into = p % POINTS_PER_LEVEL
  return {
    level: Math.floor(p / POINTS_PER_LEVEL) + 1,
    into,
    toNext: POINTS_PER_LEVEL - into,
    ratio: into / POINTS_PER_LEVEL,
  }
}
