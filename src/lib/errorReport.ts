import { classifyError } from './errors'
import { lastFailure, recentRequests } from './requestTrace'
import { supabase } from './supabase'

/** Errors the user cannot fix themselves: these get a "report to admin" button. */
const REPORTABLE = new Set(['errors.unknown', 'errors.server', 'errors.missingReference', 'errors.timeout', 'errors.updating', 'errors.notFound', 'errors.vaultDamaged'])

export function isReportable(error: unknown): boolean {
  return REPORTABLE.has(classifyError(error).key)
}

/**
 * Send a report for the admin: the screen, app version, the classified error, the raw error text,
 * the failing request (sanitized, no headers) and the server's error response.
 */
export async function sendErrorReport(error: unknown, extra?: { note?: string; stack?: string }): Promise<void> {
  const info = classifyError(error)
  const raw = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : String(error)
  const failed = lastFailure()
  const details = typeof error === 'object' && error ? (error as { details?: unknown; hint?: unknown }) : {}
  const { error: insertError } = await supabase.from('error_reports').insert({
    route: `${window.location.pathname}${window.location.search}`.slice(0, 300),
    app_version: `${__APP_VERSION__}+${__APP_COMMIT__}`.slice(0, 40),
    message_key: info.key,
    error_code: info.code ?? null,
    error_message: [raw, details.details, details.hint, extra?.stack].filter(Boolean).join('\n').slice(0, 2000),
    request: failed
      ? { method: failed.method, path: failed.path, body: failed.request, at: failed.at, duration_ms: failed.durationMs }
      : { recent: recentRequests(3).map((r) => `${r.method} ${r.path} -> ${r.status ?? r.networkError}`) },
    response: failed ? { status: failed.status, body: failed.response, network_error: failed.networkError } : null,
    user_agent: navigator.userAgent.slice(0, 300),
    note: extra?.note?.slice(0, 500) ?? null,
  })
  if (insertError) throw insertError
}
