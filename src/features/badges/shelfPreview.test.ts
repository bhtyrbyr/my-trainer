import { describe, expect, it } from 'vitest'
import type { ShelfItem } from './logic'
import { shelfPreview } from './shelfPreview'

const earned = (code: string, at: string): ShelfItem => ({ code, earnedAt: at, progress: null }) as unknown as ShelfItem
const locked = (code: string, ratio: number): ShelfItem =>
  ({ code, earnedAt: null, progress: { value: ratio * 10, threshold: 10, ratio } }) as unknown as ShelfItem

describe('shelfPreview', () => {
  it('shows newest earned first, then the three locked badges closest to done', () => {
    const items = [earned('a', '2026-10-01'), locked('x', 0.2), earned('b', '2026-10-20'), locked('y', 0.9), locked('z', 0.5), locked('w', 0.1)]
    expect(shelfPreview(items).map((i) => i.code)).toEqual(['b', 'a', 'y', 'z', 'x'])
  })
  it('caps the preview and keeps room for the next three', () => {
    const items = [
      ...Array.from({ length: 10 }, (_, n) => earned(`e${n}`, `2026-10-${String(n + 10)}`)),
      locked('l1', 0.5),
      locked('l2', 0.4),
      locked('l3', 0.3),
    ]
    const preview = shelfPreview(items, 8)
    expect(preview).toHaveLength(8)
    expect(preview.slice(0, 5).map((i) => i.code)).toEqual(['e9', 'e8', 'e7', 'e6', 'e5'])
    expect(preview.slice(5).map((i) => i.code)).toEqual(['l1', 'l2', 'l3'])
  })
  it('fills one row with locked badges when nothing is earned yet', () => {
    const items = [locked('a', 0), locked('b', 0.3), locked('c', 0.1), locked('d', 0.2), locked('e', 0)]
    expect(shelfPreview(items).map((i) => i.code)).toEqual(['b', 'd', 'c', 'a'])
  })
})
