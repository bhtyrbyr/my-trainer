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
  if (/BAD_PATH/.test(message)) return { key: 'errors.badPath', code }
  if (/PUSH_DENIED/.test(message)) return { key: 'errors.pushDenied', code }
  if (/PUSH_UNSUPPORTED|PUSH_NOT_CONFIGURED|BAD_ENDPOINT|BAD_KEY/.test(message)) return { key: 'errors.pushUnsupported', code }
  if (/ALREADY_DONE/.test(message)) return { key: 'errors.alreadyDone', code }
  if (/NOT_DUE/.test(message)) return { key: 'errors.notDue', code }
  if (/LIMIT_REACHED/.test(message)) return { key: 'errors.limitReached', code }
  if (/LAST_ADMIN/.test(message)) return { key: 'errors.lastAdmin', code }
  if (/MISSING_UPLOAD/.test(message)) return { key: 'errors.missingUpload', code }
  if (/BAD_KDF/.test(message)) return { key: 'errors.vaultDamaged', code }
  if (/SLEEP_ORDER/.test(message)) return { key: 'errors.sleepOrder', code }
  if (/SLEEP_TOO_LONG/.test(message)) return { key: 'errors.sleepTooLong', code }
  // Codes returned by the ai-coach Edge Function
  if (/UNDERAGE/.test(message)) return { key: 'errors.underage', code } // UNDERAGE and AI_UNDERAGE
  if (/AI_CONSENT_REQUIRED/.test(message)) return { key: 'errors.aiConsent', code }
  if (/AI_REGION/.test(message)) return { key: 'errors.aiRegion', code }
  if (/AI_GOOGLE_DAILY/.test(message)) return { key: 'errors.aiGoogleDaily', code }
  if (/AI_GOOGLE_MINUTE/.test(message)) return { key: 'errors.aiGoogleMinute', code }
  if (/AI_APP_LIMIT/.test(message)) return { key: 'errors.aiAppLimit', code }
  if (/AI_QUOTA/.test(message)) return { key: 'errors.aiQuota', code }
  if (/AI_NOT_CONFIGURED/.test(message)) return { key: 'errors.aiNotConfigured', code }
  if (/AI_UNAVAILABLE/.test(message)) return { key: 'errors.aiUnavailable', code }
  if (/AI_BAD_INPUT/.test(message)) return { key: 'errors.aiBadInput', code }
  if (/REPORT_LIMIT/.test(message)) return { key: 'errors.reportLimit', code }
  if (/SEARCH_BUSY/.test(message)) return { key: 'errors.searchBusy', code }
  if (/SEARCH_UNAVAILABLE/.test(message)) return { key: 'errors.searchUnavailable', code }
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
    // The app is newer or older than the database for a moment (deploy in progress): function, table or
    // column not there yet. Users see "updating, try again", never the schema message.
    case 'PGRST202':
    case 'PGRST204':
    case 'PGRST205':
    case '42883':
    case '42P01':
    case '42703':
      return { key: 'errors.updating', code }
  }
  if (/schema cache|does not exist/i.test(message)) return { key: 'errors.updating', code }
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
  const { key } = classifyError(err)
  // Technical details go to the developer console only; users always get a plain sentence.
  if (key === 'errors.unknown' || key === 'errors.updating' || key === 'errors.server') console.error('[app error]', err)
  return t(`common:${key}`)
}
