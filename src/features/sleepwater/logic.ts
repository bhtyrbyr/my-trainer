import { addDays, format, parseISO } from 'date-fns'
import type { SleepEntry, WaterEntry } from './types'

/** Minutes -> { h, m } for "7 h 45 min" style labels. */
export function splitDuration(min: number): { h: number; m: number } {
  const total = Math.max(0, Math.round(min))
  return { h: Math.floor(total / 60), m: total % 60 }
}

/**
 * Bed and wake instants for the night that ends on `day` (YYYY-MM-DD, the wake-up day).
 * A bedtime later than the wake time (23:30 vs 07:15) belongs to the previous evening.
 */
export function nightWindow(day: string, bed: string, wake: string): { bedAt: Date; wakeAt: Date } {
  const wakeAt = new Date(`${day}T${wake}:00`)
  const bedDay = bed > wake ? format(addDays(parseISO(day), -1), 'yyyy-MM-dd') : day
  const bedAt = new Date(`${bedDay}T${bed}:00`)
  return { bedAt, wakeAt }
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000)
}

/** Local HH:mm of an ISO instant (for prefilling the time inputs). */
export function hhmm(iso: string): string {
  return format(new Date(iso), 'HH:mm')
}

/** The last `n` wake-up days ending at `day` (oldest first) with the logged duration or null. */
export function sleepWeek(rows: Pick<SleepEntry, 'sleep_on' | 'duration_min'>[], day: string, n = 7): { day: string; minutes: number | null }[] {
  const byDay = new Map(rows.map((r) => [r.sleep_on, r.duration_min]))
  return Array.from({ length: n }, (_, i) => {
    const d = format(addDays(parseISO(day), i - n + 1), 'yyyy-MM-dd')
    return { day: d, minutes: byDay.get(d) ?? null }
  })
}

/** Average of the logged nights (null when none). */
export function averageMinutes(week: { minutes: number | null }[]): number | null {
  const logged = week.map((w) => w.minutes).filter((m): m is number => m != null)
  return logged.length ? Math.round(logged.reduce((a, b) => a + b, 0) / logged.length) : null
}

export function waterTotal(rows: Pick<WaterEntry, 'amount_ml'>[]): number {
  return rows.reduce((s, r) => s + r.amount_ml, 0)
}
