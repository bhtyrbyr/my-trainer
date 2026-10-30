// Pure helpers for the admin panel (access settings, invite list, per-user limits).

export type AccessMode = 'open' | 'invite'
export type AdminConfig = {
  access_mode: AccessMode
  require_approval: boolean
  ai_global_daily_limit: number
}
export type AdminConfigKey = keyof AdminConfig

/** Server defaults when a key has never been written (init_core / admin_approval / ai gate migrations). */
export const CONFIG_DEFAULTS: AdminConfig = {
  access_mode: 'open',
  require_approval: true,
  ai_global_daily_limit: 200,
}
/** user_settings.ai_daily_limit default (no settings row yet). */
export const DEFAULT_USER_AI_LIMIT = 40
export const LIMITS = { userAi: 1000, globalAi: 10000, note: 200, query: 100 } as const

/** app_config rows -> typed config; anything missing or malformed falls back to the server default. */
export function parseAdminConfig(rows: readonly { key: string; value: unknown }[]): AdminConfig {
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const mode = v.access_mode
  const approval = v.require_approval
  const limit =
    typeof v.ai_global_daily_limit === 'number' ? v.ai_global_daily_limit : Number(v.ai_global_daily_limit)
  return {
    access_mode: mode === 'invite' || mode === 'open' ? mode : CONFIG_DEFAULTS.access_mode,
    require_approval:
      typeof approval === 'boolean'
        ? approval
        : approval === 'true'
          ? true
          : approval === 'false'
            ? false
            : CONFIG_DEFAULTS.require_approval,
    ai_global_daily_limit:
      Number.isInteger(limit) && limit >= 0 ? limit : CONFIG_DEFAULTS.ai_global_daily_limit,
  }
}

/** Same rule as admin_add_allowed_email: trimmed, lowercase, something@domain.tld, at most 254 chars. */
export function normalizeEmail(input: string): string | null {
  const e = input.trim().toLowerCase()
  return e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null
}

/** A whole number typed into a limit field, within 0..max; null when it is not one. */
export function parseLimit(input: string, max: number): number | null {
  const s = input.trim()
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return n <= max ? n : null
}
