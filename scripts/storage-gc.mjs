// Maintenance: delete Storage objects whose database rows are gone (shared post photos of deleted posts,
// left social accounts, deleted users). SQL cannot remove Storage objects safely, so triggers queue the
// paths in private.storage_garbage and this script (daily, service role) removes them through the
// Storage API. Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/storage-gc.mjs
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

let total = 0
for (let round = 0; round < 20; round++) {
  const r = await fetch(`${url}/rest/v1/rpc/ops_claim_storage_garbage`, { method: 'POST', headers, body: JSON.stringify({ p_limit: 500 }) })
  if (r.status === 404) {
    console.log('ops_claim_storage_garbage not deployed yet; nothing to do')
    break
  }
  if (!r.ok) throw new Error(`claim failed: ${r.status} ${await r.text()}`)
  const rows = await r.json()
  if (!rows.length) break
  const byBucket = new Map()
  for (const { bucket, path } of rows) byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), path])
  for (const [bucket, prefixes] of byBucket) {
    const d = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}`, { method: 'DELETE', headers, body: JSON.stringify({ prefixes }) })
    if (!d.ok) throw new Error(`delete in ${bucket} failed: ${d.status} ${await d.text()}`)
    total += prefixes.length
  }
}
console.log(`removed ${total} orphaned objects`)
