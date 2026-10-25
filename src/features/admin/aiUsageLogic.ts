/**
 * Gemini's daily quotas (RPD) reset at midnight Pacific time; usage rows carry that Pacific day.
 * Pure helpers for the admin AI usage dashboard.
 */
export const QUOTA_TZ = 'America/Los_Angeles'

export type UsageRow = {
  day_pt: string
  user_id: string | null
  username: string | null
  display_name: string | null
  action: string
  model: string
  requests: number
  failed: number
  prompt_tokens: number
  output_tokens: number
  total_tokens: number
}

export type ModelLimits = Record<string, { rpm: number; tpm: number; rpd: number }>

/** Calendar date (YYYY-MM-DD) of `d` in a time zone. */
export function dayIn(tz: string, d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Minutes the time zone is ahead of UTC at instant `d` (negative for the Americas). */
export function tzOffsetMinutes(tz: string, d: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
  return Math.round((asUtc - d.getTime()) / 60000)
}

/** The next midnight in `tz` after `now` (DST-safe: offset re-evaluated at the target instant). */
export function nextMidnight(tz: string, now: Date = new Date()): Date {
  const [y, m, d] = dayIn(tz, now).split('-').map(Number)
  const localMidnightAsUtc = Date.UTC(y, m - 1, d + 1, 0, 0, 0)
  let guess = localMidnightAsUtc - tzOffsetMinutes(tz, now) * 60000
  guess = localMidnightAsUtc - tzOffsetMinutes(tz, new Date(guess)) * 60000
  return new Date(guess)
}

/** Last `days` Pacific days (oldest first) with totals; days without rows are zero. */
export function dailySeries(rows: UsageRow[], days: number, now: Date = new Date()): { day: string; requests: number; tokens: number; users: Record<string, number> }[] {
  const out: { day: string; requests: number; tokens: number; users: Record<string, number> }[] = []
  const today = dayIn(QUOTA_TZ, now)
  const [y, m, d] = today.split('-').map(Number)
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10)
    out.push({ day, requests: 0, tokens: 0, users: {} })
  }
  const index = new Map(out.map((o) => [o.day, o]))
  for (const r of rows) {
    const o = index.get(r.day_pt)
    if (!o) continue
    o.requests += r.requests
    o.tokens += r.total_tokens
    const who = r.display_name ?? r.username ?? '—'
    o.users[who] = (o.users[who] ?? 0) + r.total_tokens
  }
  return out
}

/** Today's (Pacific) requests and tokens per model from the aggregates. */
export function todayByModel(rows: UsageRow[], now: Date = new Date()): Record<string, { requests: number; tokens: number }> {
  const today = dayIn(QUOTA_TZ, now)
  const out: Record<string, { requests: number; tokens: number }> = {}
  for (const r of rows) {
    if (r.day_pt !== today) continue
    const o = (out[r.model] ??= { requests: 0, tokens: 0 })
    o.requests += r.requests
    o.tokens += r.total_tokens
  }
  return out
}

/** Parse and sanitize the admin-edited limits JSON from app_config. */
export function parseLimits(value: unknown): ModelLimits {
  const out: ModelLimits = {}
  if (!value || typeof value !== 'object') return out
  for (const [model, v] of Object.entries(value as Record<string, unknown>)) {
    const o = (v ?? {}) as Record<string, unknown>
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x) : 0)
    out[model] = { rpm: n(o.rpm), tpm: n(o.tpm), rpd: n(o.rpd) }
  }
  return out
}
