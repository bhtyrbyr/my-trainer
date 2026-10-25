import type { TFunction } from 'i18next'

/**
 * Turns any backend / network / runtime error into a short, human message key + optional detail.
 * Postgres/PostgREST codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export type AppError = { key: string; detail?: string; code?: string }

type Shape = { code?: unknown; message?: unknown; status?: unknown; details?: unknown; hint?: unknown; name?: unknown }

export function classifyError(err: unknown): AppError {
  if (!navigator.onLine) return { key: 'errors.offline' }
  if (err instanceof Error && /Failed to fetch|NetworkError|Load failed/i.test(err.message)) return { key: 'errors.network' }

  const e = (typeof err === 'object' && err !== null ? err : {}) as Shape
  const code = typeof e.code === 'string' ? e.code : undefined
  const status = typeof e.status === 'number' ? e.status : undefined
  const message =
    typeof e.message === 'string' ? e.message : err instanceof Error ? err.message : typeof err === 'string' ? err : ''

  // Custom exceptions raised by our SQL functions / triggers
  if (/ACCESS_DENIED/.test(message)) return { key: 'errors.accessDenied', code }
  if (/USERNAME_COOLDOWN/.test(message)) return { key: 'errors.usernameCooldown', code }
  if (/CANNOT_CHANGE_SELF/.test(message)) return { key: 'errors.cannotChangeSelf', code }
  if (/NOT_REJECTED/.test(message)) return { key: 'errors.notRejected', code }
  if (/ALREADY_FINISHED/.test(message)) return { key: 'errors.alreadyFinished', code }
  if (/FUTURE_DATE/.test(message)) return { key: 'errors.futureDate', code }
  // Codes returned by the ai-coach Edge Function
  if (/AI_QUOTA/.test(message)) return { key: 'errors.aiQuota', code }
  if (/AI_NOT_CONFIGURED/.test(message)) return { key: 'errors.aiNotConfigured', code }
  if (/AI_UNAVAILABLE/.test(message)) return { key: 'errors.aiUnavailable', code }
  if (/AI_BAD_INPUT/.test(message)) return { key: 'errors.aiBadInput', code }
  if (/FORBIDDEN/.test(message)) return { key: 'errors.forbidden', code }
  if (/NOT_AUTHENTICATED|JWT|jwt expired/i.test(message)) return { key: 'errors.sessionExpired', code }

  switch (code) {
    case '42501':
      return { key: 'errors.forbidden', code }
    case '23505':
      return { key: 'errors.duplicate', code, detail: columnFrom(message) }
    case '23514':
    case '22P02':
    case '22003':
      return { key: 'errors.invalidValue', code, detail: columnFrom(message) }
    case '23503':
      return { key: 'errors.missingReference', code }
    case '23502':
      return { key: 'errors.requiredField', code, detail: columnFrom(message) }
    case 'PGRST116':
      return { key: 'errors.notFound', code }
    case 'PGRST301':
    case '401':
      return { key: 'errors.sessionExpired', code }
    case '57014':
      return { key: 'errors.timeout', code }
  }
  if (status === 401) return { key: 'errors.sessionExpired', code }
  if (status === 403) return { key: 'errors.forbidden', code }
  if (status === 404) return { key: 'errors.notFound', code }
  if (status === 413) return { key: 'errors.tooLarge', code }
  if (status === 429) return { key: 'errors.rateLimited', code }
  if (status !== undefined && status >= 500) return { key: 'errors.server', code }
  if (/storage|bucket|object/i.test(message) && /size|large/i.test(message)) return { key: 'errors.tooLarge', code }

  return { key: 'errors.unknown', code, detail: message.slice(0, 160) || undefined }
}

function columnFrom(message: string): string | undefined {
  // Prefer the precise "Key (column)=" detail, then an explicit column, then the constraint name.
  return (
    message.match(/Key \((\w+)\)=/)?.[1] ??
    message.match(/column "(\w+)"/)?.[1] ??
    message.match(/constraint "(\w+)"/)?.[1]
  )
}

/** Human message for display. `t` must have the `common` namespace loaded. */
export function errorMessage(err: unknown, t: TFunction): string {
  const { key, detail } = classifyError(err)
  const base = t(`common:${key}`)
  return detail && key === 'errors.unknown' ? `${base} (${detail})` : base
}
