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

// ---------------------------------------------------------------------------------------------
// Manual matching (admin picker)

/** The exercisedb-search Edge Function accepts 2..60 characters. */
export const SEARCH_MIN = 2
export const SEARCH_MAX = 60
/** The function returns at most this many results; anything beyond is ignored. */
export const SEARCH_RESULTS_MAX = 25

export type ExerciseDbHit = { id: string; name: string }

/** Same shape as the DB check and exerciseDbGifUrl(): nothing else is ever used as an id. */
const EXERCISEDB_ID = /^[A-Za-z0-9]{4,16}$/

export function isSearchable(q: string): boolean {
  const n = q.trim().length
  return n >= SEARCH_MIN && n <= SEARCH_MAX
}

/** Words that only connect qualifiers; never useful as an ExerciseDB search term. */
const FILLER = new Set(['a', 'an', 'the', 'and', 'of', 'to', 'for', 'in'])

/**
 * The search field's starting text for a catalog name: lowercase, without parentheses, cut before a
 * qualifier ("with band", "on knees", "- version 2", after a comma), filler words dropped, at most the last
 * four words (catalog names put equipment and side in front, the movement last). Falls back to the
 * trimmed name when the cut leaves less than two characters.
 */
export function simplifyExerciseName(name: string): string {
  const base = name
    .toLocaleLowerCase('en')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .split(/[,;:/|]|\s[-–—]\s|\s(?:with|using|on|w\/)\s/)[0]
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
  const words = base.split(/\s+/).filter((w) => w && !FILLER.has(w))
  const out = words.slice(-4).join(' ').slice(0, SEARCH_MAX).trim()
  return out.length >= SEARCH_MIN ? out : name.trim().slice(0, SEARCH_MAX)
}

/** `{ results: [{ id, name }] }` from the Edge Function, validated: bad ids and duplicates dropped, capped. */
export function parseSearchResults(data: unknown): ExerciseDbHit[] {
  const list = (data as { results?: unknown } | null)?.results
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: ExerciseDbHit[] = []
  for (const r of list) {
    const id = typeof r?.id === 'string' ? r.id.trim() : ''
    if (!EXERCISEDB_ID.test(id) || seen.has(id)) continue
    seen.add(id)
    const name = typeof r?.name === 'string' && r.name.trim() ? r.name.trim() : id
    out.push({ id, name })
    if (out.length === SEARCH_RESULTS_MAX) break
  }
  return out
}

/** Match kind of one catalog row: no id is "unmatched"; an id without a recorded kind counts as manual. */
export function matchKindOf(row: { exercisedb_id: string | null; exercisedb_match?: string | null }): MatchKind {
  if (!row.exercisedb_id) return 'unmatched'
  const k = row.exercisedb_match
  return k === 'exact' || k === 'fuzzy' || k === 'ai' || k === 'manual' ? k : 'manual'
}

/** Counts after one row moved from one kind to another (never below zero). */
export function applyMatchChange(counts: MatchCounts, from: MatchKind, to: MatchKind): MatchCounts {
  if (from === to) return counts
  return { ...counts, [from]: Math.max(0, (counts[from] ?? 0) - 1), [to]: (counts[to] ?? 0) + 1 }
}

type ListPage<R> = { rows: R[]; total: number }
export type InfiniteList<R> = { pages: ListPage<R>[]; pageParams: unknown[] }

/** A cached infinite list without one row (and its total one lower when the row was there). */
export function withoutRow<R extends { id: string }>(data: InfiniteList<R> | undefined, id: string): InfiniteList<R> | undefined {
  if (!data) return data
  const present = data.pages.some((p) => p.rows.some((r) => r.id === id))
  if (!present) return data
  return {
    ...data,
    pages: data.pages.map((p) => ({ rows: p.rows.filter((r) => r.id !== id), total: Math.max(0, p.total - 1) })),
  }
}
