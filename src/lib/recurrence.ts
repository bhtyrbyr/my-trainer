/**
 * Recurrence rules shared by habits and recurring to-dos (docs/faz3-spec.md section 1).
 * Days are local calendar dates as 'YYYY-MM-DD'; all math is done in UTC on those dates so DST never
 * shifts a day. The SQL twin public.recurrence_matches() must agree (recurrence.vectors.json).
 */
export type RecurrenceRule =
  | { type: 'daily' }
  | { type: 'weekly'; days: number[] } // ISO weekday 1 = Monday ... 7 = Sunday
  | { type: 'weekly_count'; n: number } // habits only: any n days per ISO week
  | { type: 'monthly'; day: number } // 1..31, clamped to the month's last day
  | { type: 'every'; n: number } // every n days from starts_on

const DAY_MS = 86_400_000

export function parseDay(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(day: string, n: number): string {
  return formatDay(parseDay(day) + n * DAY_MS)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to) - parseDay(from)) / DAY_MS)
}

/** ISO weekday, 1 = Monday ... 7 = Sunday. */
export function isoWeekday(day: string): number {
  const w = new Date(parseDay(day)).getUTCDay()
  return w === 0 ? 7 : w
}

/** Monday of the ISO week containing `day`. */
export function weekStart(day: string): string {
  return addDays(day, 1 - isoWeekday(day))
}

function lastDayOfMonth(day: string): number {
  const d = new Date(parseDay(day))
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
}

export function isValidRule(rule: unknown, allowWeeklyCount = true): rule is RecurrenceRule {
  if (!rule || typeof rule !== 'object') return false
  const r = rule as Record<string, unknown>
  const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi
  switch (r.type) {
    case 'daily':
      return true
    case 'weekly':
      return (
        Array.isArray(r.days) &&
        r.days.length >= 1 &&
        r.days.every((d) => int(d, 1, 7)) &&
        new Set(r.days).size === r.days.length
      )
    case 'weekly_count':
      return allowWeeklyCount && int(r.n, 1, 7)
    case 'monthly':
      return int(r.day, 1, 31)
    case 'every':
      return int(r.n, 2, 365)
    default:
      return false
  }
}

/**
 * Is `day` an occurrence? For weekly_count every day of the week qualifies (the week's quota decides
 * whether it is still open; see weekCountDone).
 */
export function matches(rule: RecurrenceRule, startsOn: string, day: string): boolean {
  if (day < startsOn) return false
  switch (rule.type) {
    case 'daily':
    case 'weekly_count':
      return true
    case 'weekly':
      return rule.days.includes(isoWeekday(day))
    case 'monthly':
      return Number(day.slice(8, 10)) === Math.min(rule.day, lastDayOfMonth(day))
    case 'every':
      return daysBetween(startsOn, day) % rule.n === 0
  }
}

export function occurrencesBetween(rule: RecurrenceRule, startsOn: string, from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) if (matches(rule, startsOn, d)) out.push(d)
  return out
}

/** Days of `day`'s ISO week (up to and including `day`) that are in `doneDays`. */
export function weekCountDone(doneDays: ReadonlySet<string>, day: string): number {
  let n = 0
  for (let d = weekStart(day); d <= day; d = addDays(d, 1)) if (doneDays.has(d)) n++
  return n
}

/**
 * Current streak. Daily-style rules: consecutive due days completed, counting back from today; an
 * unfinished today does not break it. weekly_count: consecutive ISO weeks that met the quota (the
 * current week counts once it is met).
 */
export function streak(rule: RecurrenceRule, startsOn: string, doneDays: ReadonlySet<string>, today: string): number {
  if (rule.type === 'weekly_count') {
    let weeks = 0
    let w = weekStart(today)
    if (weekCountDone(doneDays, addDays(w, 6)) >= rule.n) weeks++
    for (w = addDays(w, -7); w >= weekStart(startsOn); w = addDays(w, -7)) {
      if (weekCountDone(doneDays, addDays(w, 6)) >= rule.n) weeks++
      else break
    }
    return weeks
  }
  let n = 0
  let d = today
  if (!doneDays.has(d)) d = addDays(d, -1)
  // bounded: a streak cannot be older than the habit
  for (; d >= startsOn; d = addDays(d, -1)) {
    if (!matches(rule, startsOn, d)) continue
    if (doneDays.has(d)) n++
    else break
  }
  return n
}
