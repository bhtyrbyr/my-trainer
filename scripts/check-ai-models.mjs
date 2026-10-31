// Maintenance: fail (and so e-mail the repo owner) when a Gemini model the app relies on is no longer
// offered. Models checked: the keys of app_config.ai_model_limits (what the Edge Functions use, read with
// the service role in CI only) plus the code defaults. Usage: node scripts/check-ai-models.mjs
//   GEMINI_API_KEY (required), SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (optional: also check app_config)
const key = process.env.GEMINI_API_KEY
if (!key) throw new Error('GEMINI_API_KEY missing')
const wanted = new Set(['gemini-3.5-flash-lite'])

const url = process.env.SUPABASE_URL
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (url && service) {
  const r = await fetch(`${url}/rest/v1/app_config?key=eq.ai_model_limits&select=value`, {
    headers: { apikey: service, Authorization: `Bearer ${service}` },
  })
  if (!r.ok) throw new Error(`app_config read failed: ${r.status}`)
  const [row] = await r.json()
  for (const m of Object.keys(row?.value ?? {})) wanted.add(m)
}

const offered = new Set()
let pageToken = ''
do {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`, {
    headers: { 'x-goog-api-key': key },
  })
  if (!r.ok) throw new Error(`model list failed: ${r.status}`)
  const j = await r.json()
  for (const m of j.models ?? []) offered.add(String(m.name).replace(/^models\//, ''))
  pageToken = j.nextPageToken ?? ''
} while (pageToken)

const missing = [...wanted].filter((m) => !offered.has(m))
console.log(`checked: ${[...wanted].join(', ')}`)
if (missing.length) {
  console.error(`::error::Gemini no longer offers: ${missing.join(', ')}. Update app_config.ai_model_limits (Admin > AI usage) and the defaults in supabase/functions/ai-coach/index.ts and scripts/*.mjs.`)
  process.exit(1)
}
console.log('all models available')
