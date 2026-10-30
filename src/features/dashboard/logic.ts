import { addDays, daysBetween, weekStart } from '@/lib/recurrence'
import type { WeekSummary } from './schema'

// -----------------------------------------------------------------------------
// Rule-based suggestions (pure; the page feeds in what it already knows)
// -----------------------------------------------------------------------------

/** Body parts worth a nudge when they go untrained. Cardio, neck, forearms, calves and waist are not. */
export const MAJOR_PARTS = ['chest', 'back', 'shoulders', 'upper_arms', 'upper_legs'] as const

/** A part counts as "in rotation" when it was trained at least once in this many days. */
export const ROTATION_DAYS = 28
export const MUSCLE_GAP_DAYS = 4
export const WEIGH_GAP_DAYS = 7
export const MAX_SUGGESTIONS = 2

/** Local hour from which each time-bound rule may fire. */
export const HOURS = { streak: 20, habits: 17, water: 18 } as const
export const WATER_LOW_RATIO = 0.4

export type Suggestion =
  | { id: 'streak'; kind: 'streak'; streak: number }
  | { id: 'habits'; kind: 'habits'; open: number }
  | { id: 'water'; kind: 'water'; pct: number }
  | { id: `muscle:${string}`; kind: 'muscle'; part: string; days: number }
  | { id: 'weigh'; kind: 'weigh'; days: number }

export type SuggestionInput = {
  now: Date
  /** local YYYY-MM-DD of `now` */
  today: string
  /** effective current streak (0 when already broken) and the last day that earned points */
  streak: number
  lastActiveOn: string | null
  /** habits due today and not done yet; null while unknown */
  habitsOpen: number | null
  /** normalised body part -> last local day it was trained (finished strength sessions); null while unknown */
  trainedParts: Record<string, string> | null
  /** only with health consent; null otherwise (rules that need it stay silent) */
  health: { waterMl: number; waterGoal: number; lastWeighIn: string | null } | null
}

/**
 * Every rule that currently applies, most urgent first: a streak about to break, open habits, low water,
 * a major muscle group resting too long, an overdue weigh-in. The caller filters dismissed ids and caps.
 */
export function allSuggestions(input: SuggestionInput): Suggestion[] {
  const { now, today, health } = input
  const hour = now.getHours()
  const out: Suggestion[] = []

  if (input.streak > 0 && input.lastActiveOn !== today && hour >= HOURS.streak) {
    out.push({ id: 'streak', kind: 'streak', streak: input.streak })
  }
  if (input.habitsOpen !== null && input.habitsOpen > 0 && hour >= HOURS.habits) {
    out.push({ id: 'habits', kind: 'habits', open: input.habitsOpen })
  }
  if (
    health &&
    health.waterGoal > 0 &&
    hour >= HOURS.water &&
    health.waterMl < health.waterGoal * WATER_LOW_RATIO
  ) {
    out.push({ id: 'water', kind: 'water', pct: Math.floor((health.waterMl / health.waterGoal) * 100) })
  }
  const stale = stalestPart(input.trainedParts, today)
  if (stale) out.push({ id: `muscle:${stale.part}`, kind: 'muscle', part: stale.part, days: stale.days })
  if (health?.lastWeighIn) {
    const days = daysBetween(health.lastWeighIn, today)
    if (days >= WEIGH_GAP_DAYS) out.push({ id: 'weigh', kind: 'weigh', days })
  }
  return out
}

/** At most MAX_SUGGESTIONS, skipping the ones dismissed today. */
export function pickSuggestions(input: SuggestionInput, dismissed: ReadonlySet<string>): Suggestion[] {
  return allSuggestions(input)
    .filter((s) => !dismissed.has(s.id))
    .slice(0, MAX_SUGGESTIONS)
}

/** The major part with the longest rest of at least MUSCLE_GAP_DAYS, among parts trained in the rotation window. */
export function stalestPart(
  parts: Record<string, string> | null,
  today: string,
): { part: string; days: number } | null {
  if (!parts) return null
  const windowStart = addDays(today, -ROTATION_DAYS)
  let best: { part: string; days: number } | null = null
  for (const part of MAJOR_PARTS) {
    const last = parts[part]
    if (!last || last < windowStart || last > today) continue
    const days = daysBetween(last, today)
    if (days >= MUSCLE_GAP_DAYS && (!best || days > best.days)) best = { part, days }
  }
  return best
}

/** "upper arms" / "Upper-Arms" -> "upper_arms" (same rule as the exercise vocabulary keys). */
export function partKey(name: string): string {
  return name
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** Latest local day per body part from finished sessions ({ day, parts } rows in any order). */
export function lastTrainedByPart(rows: { day: string; parts: string[] }[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) {
    for (const p of r.parts) {
      const k = partKey(p)
      if (k && (!out[k] || out[k] < r.day)) out[k] = r.day
    }
  }
  return out
}

// -----------------------------------------------------------------------------
// "Not today" memory for suggestions (localStorage value, parsed defensively)
// -----------------------------------------------------------------------------

/** Ids dismissed on `today`; anything stored for another day (or unreadable) counts as nothing. */
export function parseDismissed(raw: string | null, today: string): Set<string> {
  if (!raw) return new Set()
  try {
    const v = JSON.parse(raw) as unknown
    if (typeof v !== 'object' || v === null) return new Set()
    const { day, ids } = v as { day?: unknown; ids?: unknown }
    if (day !== today || !Array.isArray(ids)) return new Set()
    return new Set(ids.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

/** The stored value after dismissing `id` today. */
export function withDismissed(raw: string | null, today: string, id: string): string {
  const ids = parseDismissed(raw, today)
  ids.add(id)
  return JSON.stringify({ day: today, ids: [...ids] })
}

// -----------------------------------------------------------------------------
// Week summary
// -----------------------------------------------------------------------------

export type WeekStat =
  | { key: 'habits'; rate: number }
  | { key: 'todos'; count: number }
  | { key: 'sleep'; minutes: number }
  | { key: 'weight'; kg: number }
  | { key: 'water'; days: number }

/**
 * The supporting stats under the week's headline, in display order. Health stats only exist when the
 * server returned them (consent); habits only when something was due.
 */
export function weekStats(s: WeekSummary): WeekStat[] {
  const out: WeekStat[] = []
  if (s.habit_rate !== null) out.push({ key: 'habits', rate: s.habit_rate })
  out.push({ key: 'todos', count: s.todos_done })
  if (s.avg_sleep_minutes !== null) out.push({ key: 'sleep', minutes: s.avg_sleep_minutes })
  if (s.weight_change_kg !== null) out.push({ key: 'weight', kg: s.weight_change_kg })
  if (s.water_goal_days !== null) out.push({ key: 'water', days: s.water_goal_days })
  return out
}

/**
 * Grid for n stats: up to three per row, a full last row (4 -> 2 x 2; 5 -> 3 + 2 with the last cell
 * spanning two columns). Returns the column count and each cell's span.
 */
export function statGrid(n: number): { cols: number; spans: number[] } {
  if (n <= 0) return { cols: 1, spans: [] }
  const cols = n === 4 ? 2 : Math.min(n, 3)
  const spans = Array.from({ length: n }, () => 1)
  const lastRow = n % cols
  if (lastRow !== 0) spans[n - 1] = cols - lastRow + 1
  return { cols, spans }
}

/** Monday (YYYY-MM-DD) of the week `offset` weeks from the one containing `day`. */
export function weekStartOf(day: string, offset = 0): string {
  return addDays(weekStart(day), offset * 7)
}
