import type { ShelfItem } from './logic'

/** Newest earned first, then the locked ones closest to done; the full catalog lives in the sheet. */
export function shelfPreview(items: ShelfItem[], max = 8, next = 3): ShelfItem[] {
  const earned = items
    .filter((i) => i.earnedAt)
    .sort((a, b) => (b.earnedAt ?? '').localeCompare(a.earnedAt ?? ''))
  const locked = items
    .filter((i) => !i.earnedAt)
    .sort((a, b) => (b.progress?.ratio ?? 0) - (a.progress?.ratio ?? 0))
  const nextUp = locked.slice(0, earned.length ? next : Math.min(4, max))
  return [...earned.slice(0, max - nextUp.length), ...nextUp]
}
