// Maintenance: daily health check (GitHub Action). Reads ops_health() with the service role and fails
// (so GitHub e-mails the owner) when the project nears the Supabase Free limits or jobs are failing.
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/ops-health.mjs
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')

const r = await fetch(`${url}/rest/v1/rpc/ops_health`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: '{}',
})
if (!r.ok) throw new Error(`ops_health failed: ${r.status} ${await r.text()}`)
const h = await r.json()
const n = (v) => Number(v) || 0
const MB = 1024 ** 2
const problems = []
if (n(h.db_bytes) > 0.7 * 500 * MB) problems.push(`database at ${(n(h.db_bytes) / MB).toFixed(0)} MB of 500 MB`)
if (n(h.storage_bytes) > 0.7 * 1024 * MB) problems.push(`storage at ${(n(h.storage_bytes) / MB).toFixed(0)} MB of 1 GB`)
if (n(h.failed_cron_24h) > 0) problems.push(`${n(h.failed_cron_24h)} failed cron runs in 24h`)
if (n(h.http_errors_24h) > 20) problems.push(`${n(h.http_errors_24h)} failed outgoing HTTP calls (push) in 24h`)
if (n(h.open_error_reports) > 25) problems.push(`${n(h.open_error_reports)} open error reports`)

console.log(JSON.stringify(h))
if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`)
  process.exit(1)
}
console.log('healthy')
