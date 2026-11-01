/** How a catalog row got its ExerciseDB animation (exercises.exercisedb_match), plus rows without one. */
export const MATCH_KINDS = ['exact', 'fuzzy', 'ai', 'manual', 'unmatched'] as const
export type MatchKind = (typeof MATCH_KINDS)[number]
export type MatchCounts = Record<MatchKind, number>

export type MatchSummary = {
  total: number
  matched: number
  unmatched: number
  /** matched / total, 0 when the catalog is empty */
  coverage: number
  /** non-empty kinds in display order with their share of the catalog (sums to 1) */
  segments: { kind: MatchKind; count: number; ratio: number }[]
}

const clean = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)

export function matchSummary(counts: Partial<MatchCounts> | null | undefined): MatchSummary {
  const c = Object.fromEntries(MATCH_KINDS.map((k) => [k, clean(counts?.[k])])) as MatchCounts
  const total = MATCH_KINDS.reduce((s, k) => s + c[k], 0)
  const unmatched = c.unmatched
  const matched = total - unmatched
  return {
    total,
    matched,
    unmatched,
    coverage: total ? matched / total : 0,
    segments: MATCH_KINDS.filter((k) => c[k] > 0).map((kind) => ({ kind, count: c[kind], ratio: c[kind] / total })),
  }
}
