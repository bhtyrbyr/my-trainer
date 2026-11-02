// exercisedb-search Edge Function (Deno): admin-only ExerciseDB lookup for picking a catalog exercise's GIF by
// hand (v1.1.1). Third-party APIs are called only server-side (CLAUDE.md rule 4). The caller's own token is
// used for every Supabase call (rule 10, never service_role); admin rights come from public.is_admin().
// Nothing is cached or stored here: the admin then saves the chosen id with the admin_set_exercise_media RPC,
// and the client hot-links https://static.exercisedb.dev/media/<id>.gif.
//
//   POST { q: string }  (trimmed, 2..60 chars)
//     200 { results: [{ id, name }] }            at most 25; an exact id lookup (when q looks like an id) comes first
//     400 BAD_INPUT | 401 NOT_AUTHENTICATED | 403 FORBIDDEN | 405 METHOD_NOT_ALLOWED
//     502 UPSTREAM_TIMEOUT | UPSTREAM_ERROR | UPSTREAM_BAD_RESPONSE
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const UA = 'Ironmorrow/1.1 (my-trainer admin exercise media picker; +https://github.com/bhtyrbyr/my-trainer)'
const API = 'https://oss.exercisedb.dev/api/v1/exercises'
const TIMEOUT_MS = 8_000
const MAX_RESULTS = 25
const ID_RE = /^[A-Za-z0-9]{4,16}$/

type Result = { id: string; name: string }
type Upstream = { ok: true; data: unknown } | { ok: false; code: 'UPSTREAM_TIMEOUT' | 'UPSTREAM_ERROR' | 'UPSTREAM_BAD_RESPONSE' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const authorization = req.headers.get('Authorization')
  if (!authorization) return json({ error: 'NOT_AUTHENTICATED' }, 401)
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return json({ error: 'NOT_AUTHENTICATED' }, 401)
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (isAdmin !== true) return json({ error: 'FORBIDDEN' }, 403)

  let q = ''
  try {
    const body = await req.json()
    q = typeof body?.q === 'string' ? body.q.replace(/\s+/g, ' ').trim() : ''
  } catch {
    return json({ error: 'BAD_INPUT' }, 400)
  }
  if (q.length < 2 || q.length > 60) return json({ error: 'BAD_INPUT' }, 400)

  const [search, byId] = await Promise.all([
    getJson(`${API}/search?search=${encodeURIComponent(q)}&limit=${MAX_RESULTS}`),
    looksLikeId(q) ? getJson(`${API}/${encodeURIComponent(q)}`) : Promise.resolve(null),
  ])

  const results: Result[] = []
  const seen = new Set<string>()
  const push = (raw: unknown) => {
    const r = normalize(raw)
    if (r && !seen.has(r.id) && results.length < MAX_RESULTS) {
      seen.add(r.id)
      results.push(r)
    }
  }

  if (byId?.ok) push((byId.data as { data?: unknown } | null)?.data)
  if (search.ok) {
    const body = search.data as { success?: unknown; data?: unknown } | null
    const list: unknown = body?.data
    if (body?.success === false || !Array.isArray(list)) {
      if (results.length === 0) return json({ error: 'UPSTREAM_BAD_RESPONSE' }, 502)
    } else {
      for (const raw of list) push(raw)
    }
  } else if (results.length === 0) {
    return json({ error: search.code }, 502)
  }

  return json({ results })
})

// An id is one alphanumeric token that is not a plain word: it has a digit or an upper-case letter after the
// first character (ExerciseDB ids look like "0br45wL", "7M66AVi"). A miss is just an extra 404, never an error.
function looksLikeId(q: string): boolean {
  return ID_RE.test(q) && (/\d/.test(q) || /[A-Z]/.test(q.slice(1)))
}

async function getJson(url: string): Promise<Upstream> {
  let res: Response
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (e) {
    const name = (e as { name?: string })?.name
    return { ok: false, code: name === 'TimeoutError' || name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR' }
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    return { ok: false, code: 'UPSTREAM_ERROR' }
  }
  const data = await res.json().catch(() => undefined)
  if (data === undefined) return { ok: false, code: 'UPSTREAM_BAD_RESPONSE' }
  return { ok: true, data }
}

function normalize(raw: unknown): Result | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.exerciseId === 'string' ? r.exerciseId.trim() : ''
  if (!ID_RE.test(id)) return null
  const name = typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
  if (!name) return null
  return { id, name }
}
