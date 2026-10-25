import { subDays, subMonths, subYears } from 'date-fns'

/** One finished session of one exercise, as returned by the `exercise_progress` RPC (numerics coerced). */
export type ProgressPoint = {
  session_id: string
  started_at: string
  best_e1rm: number | null
  best_weight_kg: number | null
  avg_weight_kg: number | null
  best_reps: number | null
  total_volume_kg: number | null
  total_sets: number
}

/** One logged set, as returned by the `last_sets_for_exercise` RPC (numerics coerced). */
export type LoggedSet = {
  session_id: string
  started_at: string
  set_id: string
  set_no: number
  weight_kg: number | null
  reps: number | null
  rpe: number | null
  is_warmup: boolean
}

export const PROGRESS_PERIODS = ['4w', '3m', '1y', 'all'] as const
export type ProgressPeriod = (typeof PROGRESS_PERIODS)[number]

/** Inclusive lower bound of a period, or null for "all time". */
export function periodStart(period: ProgressPeriod, now: Date = new Date()): Date | null {
  switch (period) {
    case '4w':
      return subDays(now, 28)
    case '3m':
      return subMonths(now, 3)
    case '1y':
      return subYears(now, 1)
    default:
      return null
  }
}

/** Sessions inside the period, oldest first (the chart and "change %" read left to right). */
export function filterByPeriod<T extends { started_at: string }>(rows: T[], period: ProgressPeriod, now: Date = new Date()): T[] {
  const from = periodStart(period, now)?.getTime() ?? -Infinity
  const to = now.getTime()
  return rows
    .filter((r) => {
      const t = new Date(r.started_at).getTime()
      return t >= from && t <= to
    })
    .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
}

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Period average working weight: each session's average weighted by its working-set count, so a
 * 5-set day counts more than a 1-set day. Sessions without a weight (bodyweight-only) are ignored.
 */
export function periodAverage(rows: Pick<ProgressPoint, 'avg_weight_kg' | 'total_sets'>[]): number | null {
  let sum = 0
  let n = 0
  for (const r of rows) {
    if (!isNum(r.avg_weight_kg)) continue
    const w = Math.max(r.total_sets, 1)
    sum += r.avg_weight_kg * w
    n += w
  }
  return n ? sum / n : null
}

function maxOf<T>(rows: T[], pick: (r: T) => number | null | undefined): number | null {
  let best: number | null = null
  for (const r of rows) {
    const v = pick(r)
    if (isNum(v) && (best === null || v > best)) best = v
  }
  return best
}

export const bestWeight = (rows: Pick<ProgressPoint, 'best_weight_kg'>[]) => maxOf(rows, (r) => r.best_weight_kg)
export const bestE1rm = (rows: Pick<ProgressPoint, 'best_e1rm'>[]) => maxOf(rows, (r) => r.best_e1rm)

/**
 * Change of the average working weight between the first and the last weighted session of the period,
 * in percent. Null when there are fewer than two weighted sessions or the first one is zero.
 * Expects rows oldest first (see filterByPeriod).
 */
export function changePct(rows: Pick<ProgressPoint, 'avg_weight_kg'>[]): number | null {
  const weighted = rows.filter((r) => isNum(r.avg_weight_kg))
  if (weighted.length < 2) return null
  const first = weighted[0].avg_weight_kg as number
  const last = weighted[weighted.length - 1].avg_weight_kg as number
  if (first === 0) return null
  return ((last - first) / first) * 100
}

export type PeriodSummary = {
  sessions: number
  average: number | null
  best: number | null
  e1rm: number | null
  change: number | null
}

export function summarize(rows: ProgressPoint[]): PeriodSummary {
  return {
    sessions: rows.length,
    average: periodAverage(rows),
    best: bestWeight(rows),
    e1rm: bestE1rm(rows),
    change: changePct(rows),
  }
}

/** PostgREST may return numeric columns as strings; normalise to number | null. */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export type SetGroup = { weight: number | null; reps: number | null; count: number; warmup: boolean }
export type SessionSets = { session_id: string; started_at: string; groups: SetGroup[]; workingSets: number; topWeight: number | null }

/**
 * Groups `last_sets_for_exercise` rows by session (newest first, as the RPC returns them) and collapses
 * consecutive identical sets: 60x10, 60x10, 60x10 -> { 60, 10, count 3 }.
 */
export function groupSessions(sets: LoggedSet[]): SessionSets[] {
  const out: SessionSets[] = []
  const byId = new Map<string, SessionSets>()
  for (const s of sets) {
    let session = byId.get(s.session_id)
    if (!session) {
      session = { session_id: s.session_id, started_at: s.started_at, groups: [], workingSets: 0, topWeight: null }
      byId.set(s.session_id, session)
      out.push(session)
    }
    const prev = session.groups[session.groups.length - 1]
    if (prev && prev.weight === s.weight_kg && prev.reps === s.reps && prev.warmup === s.is_warmup) prev.count += 1
    else session.groups.push({ weight: s.weight_kg, reps: s.reps, count: 1, warmup: s.is_warmup })
    if (!s.is_warmup) {
      session.workingSets += 1
      if (isNum(s.weight_kg) && (session.topWeight === null || s.weight_kg > session.topWeight)) session.topWeight = s.weight_kg
    }
  }
  return out.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
}
