// Pure workout logic: no React, no Supabase. Everything here is covered by logic.test.ts.
import { addDays, endOfMonth, endOfWeek, format, getISODay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns'

// -----------------------------------------------------------------------------
// ISO weekdays (Monday = 1 ... Sunday = 7), matching Postgres extract(isodow)
// -----------------------------------------------------------------------------
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7
export const ISO_WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7]

export function isIsoWeekday(n: unknown): n is IsoWeekday {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 7
}

/** ISO weekday of a local date (Monday = 1). */
export function isoWeekday(d: Date = new Date()): IsoWeekday {
  return getISODay(d) as IsoWeekday
}

/** Deduplicated, sorted, valid ISO weekdays (drops anything outside 1..7). */
export function normalizeWeekdays(days: readonly number[] | null | undefined): IsoWeekday[] {
  return [...new Set((days ?? []).filter(isIsoWeekday))].sort((a, b) => a - b)
}

export function toggleWeekday(days: readonly number[], day: IsoWeekday): IsoWeekday[] {
  const set = new Set(normalizeWeekdays(days))
  if (set.has(day)) set.delete(day)
  else set.add(day)
  return normalizeWeekdays([...set])
}

/** Days from `from` to `to` going forward in the week (0 = same day, 6 = the day before next week). */
export function daysUntil(from: IsoWeekday, to: IsoWeekday): number {
  return (to - from + 7) % 7
}

type Planned = { id: string; weekdays: readonly number[] | null; archived?: boolean }

/**
 * The next weekday AFTER `today` that has at least one active plan, with the plans for that day.
 * Looks up to 7 days ahead, so a plan only on today's weekday returns next week's occurrence (daysAhead 7).
 */
export function nextPlannedDay<T extends Planned>(
  templates: readonly T[],
  today: IsoWeekday,
): { weekday: IsoWeekday; daysAhead: number; templates: T[] } | null {
  const active = templates.filter((t) => !t.archived)
  for (let ahead = 1; ahead <= 7; ahead++) {
    const weekday = (((today - 1 + ahead) % 7) + 1) as IsoWeekday
    const onDay = active.filter((t) => normalizeWeekdays(t.weekdays).includes(weekday))
    if (onDay.length) return { weekday, daysAhead: ahead, templates: onDay }
  }
  return null
}

/** Weekly schedule: each weekday (Monday first) with its plans, plus plans without any day. */
export function groupByWeekday<T extends Planned>(
  templates: readonly T[],
): { days: { weekday: IsoWeekday; templates: T[] }[]; unassigned: T[] } {
  const active = templates.filter((t) => !t.archived)
  return {
    days: ISO_WEEKDAYS.map((weekday) => ({
      weekday,
      templates: active.filter((t) => normalizeWeekdays(t.weekdays).includes(weekday)),
    })),
    unassigned: active.filter((t) => normalizeWeekdays(t.weekdays).length === 0),
  }
}

// -----------------------------------------------------------------------------
// Estimated duration of a template
// -----------------------------------------------------------------------------
export const DEFAULT_REST_SEC = 90
/** Time under tension per rep (seconds) incl. a short pause. */
export const SEC_PER_REP = 3
/** Unrack, brace, re-rack: fixed overhead per set. */
export const SET_OVERHEAD_SEC = 20
/** Walking to the next station, loading plates. */
export const EXERCISE_TRANSITION_SEC = 60

export type TargetLike = {
  target_sets: number
  target_reps_low: number
  target_reps_high: number
  rest_seconds: number | null
}

/** Estimated seconds for a planned workout: work + rest between sets + transitions between exercises. */
export function estimateDurationSec(exercises: readonly TargetLike[]): number {
  let total = 0
  exercises.forEach((ex, i) => {
    const sets = Math.max(0, Math.floor(ex.target_sets))
    if (sets === 0) return
    const reps = (Math.max(1, ex.target_reps_low) + Math.max(1, ex.target_reps_high, ex.target_reps_low)) / 2
    const rest = ex.rest_seconds ?? DEFAULT_REST_SEC
    total += sets * (reps * SEC_PER_REP + SET_OVERHEAD_SEC) + (sets - 1) * Math.max(0, rest)
    if (i > 0) total += EXERCISE_TRANSITION_SEC
  })
  return Math.round(total)
}

/** Minutes rounded to the nearest 5 (minimum 5 when there is any work), for "~45 min" labels. */
export function roundMinutes(sec: number): number {
  if (sec <= 0) return 0
  return Math.max(5, Math.round(sec / 60 / 5) * 5)
}

// -----------------------------------------------------------------------------
// Sets, volume, e1RM (mirror of the server-side rules in finish_workout_session)
// -----------------------------------------------------------------------------
export type SetLike = { weight_kg: number | null; reps: number | null; is_warmup?: boolean | null }

/** Working set = not a warmup and at least one rep (the server counts exactly these). */
export function isWorkingSet(s: SetLike): boolean {
  return !s.is_warmup && (s.reps ?? 0) >= 1
}

export function sessionVolumeKg(sets: readonly SetLike[]): number {
  const v = sets.filter(isWorkingSet).reduce((sum, s) => sum + (s.weight_kg ?? 0) * (s.reps ?? 0), 0)
  return Math.round(v * 10) / 10
}

export function workingSetCount(sets: readonly SetLike[]): number {
  return sets.filter(isWorkingSet).length
}

/** Epley estimated one-rep max; null when weight or reps are missing. */
export function e1rm(weightKg: number | null, reps: number | null): number | null {
  if (weightKg == null || reps == null || reps < 1 || weightKg <= 0) return null
  return Math.round(weightKg * (1 + reps / 30) * 100) / 100
}

// -----------------------------------------------------------------------------
// Prefill: "last time" first, then the previous set in this session, then the plan target
// -----------------------------------------------------------------------------
export type PrefillSource = 'last' | 'session' | 'target' | 'none'
export type Prefill = { weightKg: number | null; reps: number | null; source: PrefillSource }

/**
 * Values for the next set of one exercise.
 *  1. the same working-set number from the last finished session (set 2 today <- set 2 last time)
 *  2. else the most recent set logged in this session for this exercise
 *  3. else the plan's lower rep target (weight unknown)
 * Warmups are ignored on both sides so a warmup does not shift the mapping.
 */
export function prefillNextSet(args: {
  lastTime: readonly SetLike[]
  thisSession: readonly SetLike[]
  targetRepsLow?: number | null
}): Prefill {
  const lastWorking = args.lastTime.filter(isWorkingSet)
  const doneWorking = args.thisSession.filter(isWorkingSet)
  const fromLast = lastWorking[doneWorking.length]
  if (fromLast) return { weightKg: fromLast.weight_kg, reps: fromLast.reps, source: 'last' }

  const prev = args.thisSession[args.thisSession.length - 1]
  if (prev) return { weightKg: prev.weight_kg, reps: prev.reps, source: 'session' }

  if (args.targetRepsLow != null && args.targetRepsLow >= 1) {
    return { weightKg: null, reps: args.targetRepsLow, source: 'target' }
  }
  return { weightKg: null, reps: null, source: 'none' }
}

// -----------------------------------------------------------------------------
// Rest timer: always derived from the stored end timestamp, never from tick counts
// -----------------------------------------------------------------------------
export function restRemainingMs(endsAt: number | null | undefined, now: number): number {
  if (endsAt == null || !Number.isFinite(endsAt)) return 0
  return Math.max(0, endsAt - now)
}

/** Whole seconds to show: rounds up so the display reads 1 until the very end, then 0. */
export function restRemainingSec(endsAt: number | null | undefined, now: number): number {
  return Math.ceil(restRemainingMs(endsAt, now) / 1000)
}

/** +30 s while running extends the end; after it ran out, it restarts from now. */
export function extendRest(endsAt: number | null, now: number, addSec: number): number {
  return Math.max(endsAt ?? now, now) + addSec * 1000
}

/** 0..1 share of the rest still to go (for the bar). */
export function restProgress(endsAt: number | null, totalSec: number | null, now: number): number {
  if (!endsAt || !totalSec || totalSec <= 0) return 0
  return Math.min(1, restRemainingMs(endsAt, now) / (totalSec * 1000))
}

/** True when a timer ran out recently enough that the user should still hear/feel it (not on a stale resume). */
export function shouldAlertRestEnd(endsAt: number, now: number, graceMs = 4000): boolean {
  return now >= endsAt && now - endsAt <= graceMs
}

/** m:ss, or h:mm:ss past an hour. Negative input reads as 0:00. */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

// -----------------------------------------------------------------------------
// Numbers and units
// -----------------------------------------------------------------------------
// Weight units, conversions and display rounding live in src/lib/units.ts (useUnits / useWeightUnit).
export { parseDecimal } from '@/lib/units'

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** Step a value and snap to the step grid, so 81 + 2.5 -> 82.5 rather than 83.5. Never below `min`. */
export function stepValue(value: number | null, delta: number, min = 0, max = Number.POSITIVE_INFINITY): number {
  const base = value ?? 0
  const step = Math.abs(delta)
  const next = delta > 0 ? Math.floor(base / step + 1e-9) * step + step : Math.ceil(base / step - 1e-9) * step - step
  return clamp(Math.round(next * 1000) / 1000, min, max)
}

/** "80 × 8, 80 × 8, 75 × 10": working sets only; the caller adds the unit to the first figure. */
export function formatSetList(sets: readonly SetLike[], fmtWeight: (kg: number) => string): string[] {
  return sets.filter(isWorkingSet).map((s) => (s.weight_kg == null || s.weight_kg === 0 ? `${s.reps}` : `${fmtWeight(s.weight_kg)} × ${s.reps}`))
}

// -----------------------------------------------------------------------------
// Session structure helpers
// -----------------------------------------------------------------------------
export type TargetRow = TargetLike & { exercise_id: string; position: number }

/**
 * Plan targets for each session exercise: copied rows keep their template position, so match on
 * (position, exercise) first, then the first unused template row of the same exercise.
 */
export function matchTargets<
  E extends { id: string; exercise_id: string; position: number },
  T extends { exercise_id: string; position: number },
>(sessionExercises: readonly E[], targets: readonly T[]): Map<string, T> {
  const out = new Map<string, T>()
  const used = new Set<T>()
  for (const se of sessionExercises) {
    const exact = targets.find((t) => !used.has(t) && t.position === se.position && t.exercise_id === se.exercise_id)
    if (exact) {
      out.set(se.id, exact)
      used.add(exact)
    }
  }
  for (const se of sessionExercises) {
    if (out.has(se.id)) continue
    const any = targets.find((t) => !used.has(t) && t.exercise_id === se.exercise_id)
    if (any) {
      out.set(se.id, any)
      used.add(any)
    }
  }
  return out
}

/** Next position for an exercise appended mid-session. */
export function nextPosition(items: readonly { position: number }[]): number {
  return items.reduce((max, i) => Math.max(max, i.position), -1) + 1
}

/** After finishing/skipping at `current`, the next exercise index that is not skipped (or null at the end). */
export function nextExerciseIndex(
  exercises: readonly { id: string }[],
  current: number,
  skipped: ReadonlySet<string> | readonly string[],
): number | null {
  const skip = skipped instanceof Set ? skipped : new Set(skipped as readonly string[])
  for (let i = current + 1; i < exercises.length; i++) if (!skip.has(exercises[i].id)) return i
  return null
}

// -----------------------------------------------------------------------------
// Draft persisted per session (survives a locked phone or reload)
// -----------------------------------------------------------------------------
export type SessionDraft = {
  v: 1
  exerciseIndex: number
  restEndsAt: number | null
  restTotalSec: number | null
  skipped: string[]
}

export const DRAFT_PREFIX = 'mt.workout.draft.'
export const draftKey = (sessionId: string) => `${DRAFT_PREFIX}${sessionId}`
export const emptyDraft = (): SessionDraft => ({ v: 1, exerciseIndex: 0, restEndsAt: null, restTotalSec: null, skipped: [] })

/** Tolerant parse: anything malformed falls back to field defaults instead of throwing. */
export function parseDraft(raw: string | null | undefined): SessionDraft {
  if (!raw) return emptyDraft()
  let o: unknown
  try {
    o = JSON.parse(raw)
  } catch {
    return emptyDraft()
  }
  if (typeof o !== 'object' || o === null) return emptyDraft()
  const r = o as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const idx = num(r.exerciseIndex)
  return {
    v: 1,
    exerciseIndex: idx != null && idx >= 0 ? Math.floor(idx) : 0,
    restEndsAt: num(r.restEndsAt),
    restTotalSec: num(r.restTotalSec),
    skipped: Array.isArray(r.skipped) ? r.skipped.filter((s): s is string => typeof s === 'string') : [],
  }
}

// -----------------------------------------------------------------------------
// Calendar
// -----------------------------------------------------------------------------
/** Monday-first weeks covering the whole month; days outside the month are flagged. */
export function monthGrid(month: Date): { date: Date; key: string; inMonth: boolean }[][] {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  const weeks: { date: Date; key: string; inMonth: boolean }[][] = []
  for (let d = start; d <= end; d = addDays(d, 7)) {
    weeks.push(
      Array.from({ length: 7 }, (_, i) => {
        const date = addDays(d, i)
        return { date, key: format(date, 'yyyy-MM-dd'), inMonth: isSameMonth(date, month) }
      }),
    )
  }
  return weeks
}

/** Local calendar days (yyyy-MM-dd) that have at least one session. */
export function trainingDays(sessions: readonly { started_at: string }[]): Set<string> {
  return new Set(sessions.map((s) => format(new Date(s.started_at), 'yyyy-MM-dd')))
}

// -----------------------------------------------------------------------------
// Cardio form -> row values
// -----------------------------------------------------------------------------
export const CARDIO_ACTIVITIES = ['run', 'walk', 'bike', 'row', 'swim', 'hiit', 'other'] as const
export type CardioActivity = (typeof CARDIO_ACTIVITIES)[number]

export function cardioValues(input: { minutes: number; distanceKm: number | null; avgHr: number | null }): {
  duration_sec: number
  distance_m: number | null
  avg_hr: number | null
} {
  return {
    duration_sec: Math.round(input.minutes * 60),
    distance_m: input.distanceKm != null && input.distanceKm > 0 ? Math.round(input.distanceKm * 1000) : null,
    avg_hr: input.avgHr != null && input.avgHr > 0 ? Math.round(input.avgHr) : null,
  }
}

/** Pace in seconds per km (null without distance). */
export function paceSecPerKm(durationSec: number, distanceM: number | null): number | null {
  if (!distanceM || distanceM <= 0 || durationSec <= 0) return null
  return Math.round(durationSec / (distanceM / 1000))
}
