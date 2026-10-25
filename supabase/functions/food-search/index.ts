// food-search Edge Function (Deno): packaged-product search in Open Food Facts for the add-food sheet.
// Third-party APIs are called only server-side (CLAUDE.md rule 4). No key is needed; OFF asks for a
// descriptive User-Agent and allows ~10 searches per minute per IP, so results are cached in memory
// and the client only searches on an explicit tap.
//
//   POST { q: string }  ->  { items: [{ code, name, brand, kcal_100g, protein_100g, carb_100g, fat_100g, serving_g, serving_label }] }
//
// Data: Open Food Facts, ODbL / DbCL (attribution shown in the UI).
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const UA = 'my-trainer/0.3 (+https://github.com/bhtyrbyr/my-trainer)'
const FIELDS = 'code,product_name,product_name_tr,brands,nutriments,serving_size,serving_quantity,countries_tags'
const TTL_MS = 60 * 60 * 1000
const cache = new Map<string, { at: number; items: Item[] }>()

type Item = {
  code: string
  name: string
  brand: string | null
  kcal_100g: number
  protein_100g: number
  carb_100g: number
  fat_100g: number
  serving_g: number | null
  serving_label: string | null
}

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
  const { data: allowed } = await supabase.rpc('can_access')
  if (allowed !== true) return json({ error: 'FORBIDDEN' }, 403)

  let q = ''
  try {
    const body = await req.json()
    q = typeof body?.q === 'string' ? body.q.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
  } catch {
    return json({ error: 'BAD_INPUT' }, 400)
  }
  if (q.length < 2) return json({ error: 'BAD_INPUT' }, 400)

  const key = q.toLocaleLowerCase('tr')
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return json({ items: hit.items, cached: true })

  const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&langs=tr,en&page_size=30&fields=${FIELDS}`
  let res: Response
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
  } catch {
    return json({ error: 'SEARCH_UNAVAILABLE' }, 502)
  }
  if (res.status === 429 || res.status === 503) return json({ error: 'SEARCH_BUSY' }, 503)
  if (!res.ok) return json({ error: 'SEARCH_UNAVAILABLE' }, 502)

  const data = await res.json().catch(() => null)
  const hits: Record<string, unknown>[] = Array.isArray(data?.hits) ? data.hits : []
  const items = hits
    .map(normalize)
    .filter((i): i is Item & { turkey: boolean } => i !== null)
    .sort((a, b) => Number(b.turkey) - Number(a.turkey))
    .slice(0, 20)
    .map(({ turkey: _t, ...rest }) => rest)

  if (cache.size > 500) cache.clear()
  cache.set(key, { at: Date.now(), items })
  return json({ items })
})

function normalize(h: Record<string, unknown>): (Item & { turkey: boolean }) | null {
  const n = (h.nutriments ?? {}) as Record<string, unknown>
  const num = (v: unknown, max: number) => {
    const x = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(x) ? Math.round(Math.min(Math.max(x, 0), max) * 10) / 10 : null
  }
  let kcal = num(n['energy-kcal_100g'], 1000)
  if (kcal === null) {
    const kj = num(n['energy_100g'], 4200)
    kcal = kj === null ? null : Math.round((kj / 4.184) * 10) / 10
  }
  if (kcal === null) return null
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null)
  const name = str(h.product_name_tr, 120) ?? str(h.product_name, 120)
  if (!name) return null
  const brands = Array.isArray(h.brands) ? (h.brands as unknown[]).filter((b) => typeof b === 'string').join(', ') : h.brands
  const servingG = num(h.serving_quantity, 2000)
  const countries = Array.isArray(h.countries_tags) ? (h.countries_tags as string[]) : []
  return {
    code: String(h.code ?? '').slice(0, 32),
    name,
    brand: str(brands, 60),
    kcal_100g: kcal,
    protein_100g: num(n['proteins_100g'], 100) ?? 0,
    carb_100g: num(n['carbohydrates_100g'], 100) ?? 0,
    fat_100g: num(n['fat_100g'], 100) ?? 0,
    serving_g: servingG && servingG > 0 ? servingG : null,
    serving_label: str(h.serving_size, 40),
    turkey: countries.some((c) => c === 'en:turkey' || c === 'en:turkiye'),
  }
}
