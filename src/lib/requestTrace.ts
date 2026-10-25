/**
 * In-memory trace of the last few backend requests, so a user-initiated error report can say which
 * endpoint failed, with what request and what the server answered. Nothing is persisted; nothing is
 * sent anywhere unless the user taps "report to admin".
 *
 * Privacy: request headers (tokens, keys) are never recorded; auth, photo-vault, progress-photo and
 * storage endpoints keep no bodies (wrapped keys, IVs, ciphertext); secret-looking fields and long
 * base64 payloads are redacted; every excerpt is truncated.
 */
export type TraceEntry = {
  at: string
  method: string
  path: string
  status: number | null
  durationMs: number
  request: string | null
  response: string | null
  networkError: string | null
}

const MAX_ENTRIES = 20
const MAX_BODY = 1500
const SECRET_KEYS = /"(password|refresh_token|access_token|code_verifier|token|apikey|api_key|secret|authorization)"\s*:\s*"[^"]*"/gi
const BASE64_RUN = /[A-Za-z0-9+/=_-]{200,}/g
// endpoints whose bodies are never recorded, not even redacted
const NO_BODY_PATH = /^\/(auth\/|storage\/|rest\/v1\/(photo_vault|progress_photos)\b)/

const entries: TraceEntry[] = []

export function sanitizeBody(body: string | null | undefined): string | null {
  if (!body) return null
  const cleaned = body.replace(SECRET_KEYS, '"$1":"[redacted]"').replace(BASE64_RUN, '[data omitted]')
  return cleaned.length > MAX_BODY ? `${cleaned.slice(0, MAX_BODY)}…` : cleaned
}

/** Path + query without the host; `noBody` endpoints (auth, photos, storage) never keep bodies. */
export function describeUrl(raw: string): { path: string; noBody: boolean } {
  try {
    const u = new URL(raw)
    return { path: `${u.pathname}${u.search}`.slice(0, 500), noBody: NO_BODY_PATH.test(u.pathname) }
  } catch {
    return { path: raw.slice(0, 500), noBody: true }
  }
}

function push(e: TraceEntry) {
  entries.push(e)
  if (entries.length > MAX_ENTRIES) entries.shift()
}

/** fetch wrapper for the Supabase client (global.fetch). */
export const tracedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const { path, noBody } = describeUrl(url)
  const started = performance.now()
  const reqBody = !noBody && typeof init?.body === 'string' ? sanitizeBody(init.body) : null
  try {
    const res = await fetch(input, init)
    let response: string | null = null
    if (!res.ok && !noBody) {
      response = sanitizeBody(await res.clone().text().catch(() => null))
    }
    push({ at: new Date().toISOString(), method, path, status: res.status, durationMs: Math.round(performance.now() - started), request: reqBody, response, networkError: null })
    return res
  } catch (e) {
    push({
      at: new Date().toISOString(),
      method,
      path,
      status: null,
      durationMs: Math.round(performance.now() - started),
      request: reqBody,
      response: null,
      networkError: e instanceof Error ? e.message.slice(0, 200) : 'network error',
    })
    throw e
  }
}

/** The most recent failed request (HTTP >= 400 or network error) within `withinMs`. */
export function lastFailure(withinMs = 60_000): TraceEntry | null {
  const since = Date.now() - withinMs
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (Date.parse(e.at) < since) break
    if (e.status === null || e.status >= 400) return e
  }
  return null
}

export function recentRequests(n = 5): TraceEntry[] {
  return entries.slice(-n)
}
