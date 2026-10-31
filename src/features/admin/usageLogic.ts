import type { Json } from '@/lib/database.types'

/** Supabase Free plan limits (checked 2026-10-31, README "Free-tier limits"). */
export const FREE_TIER = {
  dbBytes: 500 * 1024 ** 2,
  storageBytes: 1024 ** 3,
  edgeCallsMonth: 500_000,
} as const

export type UsageSummary = {
  dbBytes: number
  storage: Record<string, number>
  storageBytes: number
  usersTotal: number
  usersActive7d: number
  edgeCallsMonth: number
}

export type MeterKey = 'db' | 'storage' | 'edge'
export type Meter = { key: MeterKey; used: number; limit: number; ratio: number }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

/** admin_usage_summary() jsonb -> typed summary (bigint counts may arrive as strings). */
export function parseUsageSummary(raw: Json | null): UsageSummary {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const storageRaw = (o.storage && typeof o.storage === 'object' ? o.storage : {}) as Record<string, unknown>
  const storage = Object.fromEntries(Object.entries(storageRaw).map(([k, v]) => [k, num(v)]))
  return {
    dbBytes: num(o.db_bytes),
    storage,
    storageBytes: Object.values(storage).reduce((a, b) => a + b, 0),
    usersTotal: num(o.users_total),
    usersActive7d: num(o.users_active_7d),
    // estimate: AI requests and delivered reminders are the Edge Function calls we can count
    edgeCallsMonth: num(o.ai_calls_month) + num(o.push_month),
  }
}

export function usageMeters(s: UsageSummary): Meter[] {
  const m = (key: MeterKey, used: number, limit: number): Meter => ({ key, used, limit, ratio: Math.min(used / limit, 1) })
  return [m('db', s.dbBytes, FREE_TIER.dbBytes), m('storage', s.storageBytes, FREE_TIER.storageBytes), m('edge', s.edgeCallsMonth, FREE_TIER.edgeCallsMonth)]
}

/** Human size with one decimal below 10 (e.g. "8.4 MB", "312 MB", "1 GB"). */
export function formatBytes(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 }).format(v)} ${units[i]}`
}
