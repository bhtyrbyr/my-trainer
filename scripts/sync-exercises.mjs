#!/usr/bin/env node
// Exercise catalog sync: ExerciseDB (exercises + GIFs) and wger (muscles + SVG layers)
// into the Supabase `exercises` / `muscles` / `muscle_aliases` / `exercise_catalog_meta`
// tables and the private `exercise-media` storage bucket.
//
// Contract: docs/faz1-spec.md section 5. Product rules: docs/PRD.md section 2.2.
//
// Usage
//   node scripts/sync-exercises.mjs                 full sync (needs credentials)
//   node scripts/sync-exercises.mjs --dry-run       fetch + report counts, writes nothing,
//                                                   no credentials required
//   node scripts/sync-exercises.mjs --skip-media    rows only, no GIF/SVG download/upload
//   node scripts/sync-exercises.mjs --only=exercisedb | --only=wger
//   node scripts/sync-exercises.mjs --concurrency=4 media worker count (default 4)
//
// Credentials (never committed; `*.local` is gitignored)
//   SUPABASE_URL                 https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    privileged key; GitHub Secret in CI, or locally in
//                                ./.env.sync.local as plain KEY=VALUE lines:
//                                  SUPABASE_URL=https://xxxx.supabase.co
//                                  SUPABASE_SERVICE_ROLE_KEY=eyJ...
//   Variables already present in the environment win over the file.
//
// Behaviour
//   - Idempotent and resumable: exercises are upserted by `external_id`, muscles by
//     `wger_id`, media already present in the bucket is skipped (one listing up front).
//   - User-editable columns (`name_tr`, `instructions_tr`) are never overwritten; the
//     Turkish seed in scripts/exercise-names-tr.json fills `name_tr` only where it is null.
//   - Custom exercises (`is_custom = true`) are never touched.
//   - Rate-friendly: ExerciseDB sits behind Cloudflare with roughly 10 requests per 10 s;
//     page requests are paced at ~1/s, 429 responses honour Retry-After, every HTTP call
//     retries 3 times with exponential backoff, media uploads run with concurrency 4.
//   - Exit code 1 if any hard failure happened (the run still completes so progress is kept).
//
// Known API quirks (verified 2026-10-25)
//   - ExerciseDB caps page size at 25 regardless of `limit` (1500 exercises = 60 pages).
//   - The cursor is passed as `?after=<meta.nextCursor>`; a `cursor=` parameter is silently
//     ignored and returns the first page forever.
//   - The last page has `hasNextPage: false` and no `nextCursor`.
//   - Some wger muscles have an empty `name_en`; the Latin name is used as fallback.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const EXERCISEDB_API = 'https://oss.exercisedb.dev/api/v1/exercises'
const WGER_MUSCLES_API = 'https://wger.de/api/v2/muscle/?limit=50'
const WGER_SILHOUETTES = {
  'muscles/front.svg': 'https://wger.de/static/images/muscles/muscular_system_front.svg',
  'muscles/back.svg': 'https://wger.de/static/images/muscles/muscular_system_back.svg',
}
const BUCKET = 'exercise-media'
const LICENSE = {
  exercisedb: 'Exercise data and GIFs: ExerciseDB (open source), https://exercisedb.dev',
  wger: 'Muscle diagrams: wger, CC-BY-SA 4.0, https://wger.de',
}
const RETRIES = 3
const BACKOFF_BASE_MS = 1000
const API_MIN_INTERVAL_MS = 1100 // ExerciseDB JSON pages (Cloudflare limit ~10 req / 10 s)
const MEDIA_MIN_INTERVAL_MS = 150 // static.exercisedb.dev / wger.de downloads
const DB_CHUNK = 200
const STORAGE_PAGE = 1000

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

// ---------------------------------------------------------------------------
// CLI + env
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 40).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(0)
}
const DRY_RUN = Boolean(args['dry-run'])
const SKIP_MEDIA = Boolean(args['skip-media'])
const ONLY = args.only ?? null
const CONCURRENCY = Math.max(1, Number(args.concurrency ?? 4) || 4)
if (ONLY && !['exercisedb', 'wger'].includes(ONLY)) fail(`--only must be "exercisedb" or "wger", got "${ONLY}"`)
const RUN_EXERCISEDB = !ONLY || ONLY === 'exercisedb'
const RUN_WGER = !ONLY || ONLY === 'wger'

loadEnvFile(resolve(root, '.env.sync.local'))
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const HAS_CREDS = Boolean(SUPABASE_URL && SERVICE_KEY)
if (!DRY_RUN && !HAS_CREDS) {
  fail('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (set them in the environment or ./.env.sync.local). Use --dry-run to run without credentials.')
}

const supabase = HAS_CREDS
  ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null

// ---------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------

const startedAt = Date.now()
const stats = {
  exercisedb: { pages: 0, fetched: 0, unique: 0, upserted: 0, gifsExisting: 0, gifsUploaded: 0, gifsFailed: 0, gifsSkipped: 0, nameTrApplied: 0, nameTrAlreadySet: 0, nameTrMissingIds: 0 },
  wger: { muscles: 0, upserted: 0, svgsExisting: 0, svgsUploaded: 0, svgsFailed: 0, svgsSkipped: 0, silhouettesOk: 0, silhouettesMissing: 0, aliasesApplied: 0, aliasesUnmapped: 0 },
  meta: 0,
}
const warnings = []
const errors = []
const warn = (msg) => { warnings.push(msg); console.warn(`  ! ${msg}`) }
const hardError = (msg) => { errors.push(msg); console.error(`  x ${msg}`) }
const log = (msg) => console.log(msg)

// Request pacing gates (must be initialised before the top-level await below runs).
const apiGate = makeGate(API_MIN_INTERVAL_MS)
const mediaGate = makeGate(MEDIA_MIN_INTERVAL_MS)

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

try {
  log(`sync-exercises  mode=${DRY_RUN ? 'DRY RUN' : 'write'}${SKIP_MEDIA ? ' (skip media)' : ''}${ONLY ? ` only=${ONLY}` : ''}  concurrency=${CONCURRENCY}  credentials=${HAS_CREDS ? 'yes' : 'no'}`)

  const existing = await listExistingMedia()

  if (RUN_EXERCISEDB) await syncExerciseDb(existing)
  if (RUN_WGER) await syncWger(existing)

  printSummary()
  // Set the exit code and let the event loop drain: an abrupt process.exit() right after
  // fetch() can trip a libuv assertion on Windows while undici sockets are still closing.
  process.exitCode = errors.length ? 1 : 0
} catch (err) {
  hardError(err?.stack || String(err))
  printSummary()
  process.exitCode = 1
}

// ---------------------------------------------------------------------------
// ExerciseDB
// ---------------------------------------------------------------------------

async function syncExerciseDb(existing) {
  log('\n[exercisedb] fetching catalog')
  const exercises = await fetchAllExercises()
  const s = stats.exercisedb
  s.unique = exercises.length

  // Vocabulary report: muscle names that the alias file does not know about.
  const aliases = loadAliases()
  const catalogMuscles = new Set(exercises.flatMap((e) => [...e.targetMuscles, ...e.secondaryMuscles]))
  const unmapped = [...catalogMuscles].filter((m) => !(m in aliases)).sort()
  stats.wger.aliasesUnmapped = unmapped.length
  if (unmapped.length) warn(`${unmapped.length} ExerciseDB muscle name(s) missing from scripts/muscle-aliases.json: ${unmapped.join(', ')}`)

  // Media: GIFs.
  const gifPath = new Map() // exerciseId -> storage path when known to exist
  for (const e of exercises) if (existing.has(`gifs/${e.exerciseId}.gif`)) gifPath.set(e.exerciseId, `gifs/${e.exerciseId}.gif`)
  s.gifsExisting = gifPath.size
  const todo = exercises.filter((e) => !gifPath.has(e.exerciseId))
  if (SKIP_MEDIA) {
    s.gifsSkipped = todo.length
    log(`[exercisedb] media skipped (--skip-media): ${s.gifsExisting} GIF(s) already in bucket, ${todo.length} not present`)
  } else if (DRY_RUN) {
    s.gifsSkipped = todo.length
    log(`[exercisedb] dry run: would download ${todo.length} GIF(s) (${s.gifsExisting} already in bucket${HAS_CREDS ? '' : ', bucket not listed: no credentials'})`)
  } else {
    log(`[exercisedb] uploading ${todo.length} GIF(s), ${s.gifsExisting} already present`)
    let done = 0
    await pMap(todo, CONCURRENCY, async (e) => {
      const path = `gifs/${e.exerciseId}.gif`
      try {
        const buf = await downloadBinary(e.gifUrl, mediaGate)
        if (buf.subarray(0, 4).toString('latin1') !== 'GIF8') throw new Error('response is not a GIF')
        await uploadToBucket(path, buf, 'image/gif')
        gifPath.set(e.exerciseId, path)
        s.gifsUploaded++
      } catch (err) {
        s.gifsFailed++
        hardError(`GIF ${e.exerciseId} (${e.name}): ${err.message}`)
      } finally {
        done++
        if (done % 100 === 0 || done === todo.length) log(`[exercisedb]   ${done}/${todo.length} GIFs processed (${s.gifsUploaded} ok, ${s.gifsFailed} failed)`)
      }
    })
  }

  // Rows.
  const rows = exercises.map((e) => {
    const row = {
      external_id: e.exerciseId,
      source: 'exercisedb',
      is_custom: false,
      name_en: capitalize(e.name),
      body_parts: e.bodyParts ?? [],
      target_muscles: e.targetMuscles ?? [],
      secondary_muscles: e.secondaryMuscles ?? [],
      equipment: e.equipments ?? [],
      instructions_en: (e.instructions ?? []).map(cleanInstruction),
    }
    // Only assert gif_path when we know the file is in the bucket; never null-out an earlier value.
    if (gifPath.has(e.exerciseId)) row.gif_path = gifPath.get(e.exerciseId)
    return row
  })
  if (DRY_RUN) {
    log(`[exercisedb] dry run: would upsert ${rows.length} exercise row(s) (${rows.filter((r) => r.gif_path).length} with gif_path)`)
  } else {
    s.upserted = await upsertRows('exercises', rows, 'external_id')
    log(`[exercisedb] upserted ${s.upserted} exercise row(s)`)
  }

  await applyTurkishNames(exercises)

  await upsertMeta('exercisedb', exercises.length)
}

async function fetchAllExercises() {
  const byId = new Map()
  let cursor = null
  const seenCursors = new Set()
  for (;;) {
    const url = new URL(EXERCISEDB_API)
    url.searchParams.set('limit', '100') // server caps at 25; harmless if they raise it
    if (cursor) url.searchParams.set('after', cursor)
    const page = await fetchJson(url, apiGate)
    if (!page || page.success === false || !Array.isArray(page.data)) throw new Error(`ExerciseDB: unexpected response shape on page ${stats.exercisedb.pages + 1}`)
    stats.exercisedb.pages++
    stats.exercisedb.fetched += page.data.length
    for (const e of page.data) {
      if (!e?.exerciseId || !e?.name) { warn(`ExerciseDB: skipping malformed item on page ${stats.exercisedb.pages}`); continue }
      byId.set(e.exerciseId, e)
    }
    const meta = page.meta ?? {}
    if (stats.exercisedb.pages === 1) log(`[exercisedb]   total=${meta.total ?? '?'} pageSize=${page.data.length}`)
    if (stats.exercisedb.pages % 10 === 0) log(`[exercisedb]   page ${stats.exercisedb.pages}: ${byId.size} exercises so far`)
    if (!meta.hasNextPage || !meta.nextCursor) break
    if (seenCursors.has(meta.nextCursor)) throw new Error(`ExerciseDB: pagination loop detected at cursor ${meta.nextCursor}`)
    seenCursors.add(meta.nextCursor)
    cursor = meta.nextCursor
  }
  log(`[exercisedb]   ${stats.exercisedb.pages} page(s), ${stats.exercisedb.fetched} item(s), ${byId.size} unique`)
  if (stats.exercisedb.fetched !== byId.size) warn(`ExerciseDB returned ${stats.exercisedb.fetched - byId.size} duplicate item(s) across pages`)
  return [...byId.values()]
}

async function applyTurkishNames(exercises) {
  const file = resolve(root, 'scripts/exercise-names-tr.json')
  if (!existsSync(file)) { warn('scripts/exercise-names-tr.json not found; name_tr seed skipped'); return }
  const seed = JSON.parse(readFileSync(file, 'utf8'))
  const names = seed.names ?? seed
  const catalogIds = new Set(exercises.map((e) => e.exerciseId))
  const entries = Object.entries(names).filter(([id, tr]) => typeof tr === 'string' && tr.trim())
  const missing = entries.filter(([id]) => !catalogIds.has(id))
  stats.exercisedb.nameTrMissingIds = missing.length
  if (missing.length) warn(`${missing.length} id(s) in exercise-names-tr.json are not in the ExerciseDB catalog: ${missing.map(([id]) => id).join(', ')}`)
  const applicable = entries.filter(([id]) => catalogIds.has(id))

  if (DRY_RUN) {
    log(`[exercisedb] dry run: ${applicable.length} Turkish name(s) match catalog ids (applied only where name_tr is null)`)
    return
  }
  // Find rows whose name_tr is still null, then update each one with the null guard in the
  // predicate so a concurrent user edit can never be overwritten.
  const ids = applicable.map(([id]) => id)
  const needs = new Set()
  for (const chunk of chunks(ids, 100)) {
    const { data, error } = await withRetry(() => supabase.from('exercises').select('external_id,name_tr').in('external_id', chunk), 'select name_tr')
    if (error) throw new Error(`select exercises.name_tr: ${error.message}`)
    for (const r of data) { if (r.name_tr == null) needs.add(r.external_id); else stats.exercisedb.nameTrAlreadySet++ }
  }
  for (const [id, tr] of applicable) {
    if (!needs.has(id)) continue
    const { error } = await withRetry(() => supabase.from('exercises').update({ name_tr: tr.trim() }).eq('external_id', id).is('name_tr', null), `update name_tr ${id}`)
    if (error) { hardError(`name_tr ${id}: ${error.message}`); continue }
    stats.exercisedb.nameTrApplied++
  }
  log(`[exercisedb] name_tr seed: ${stats.exercisedb.nameTrApplied} applied, ${stats.exercisedb.nameTrAlreadySet} already set`)
}

// ---------------------------------------------------------------------------
// wger
// ---------------------------------------------------------------------------

async function syncWger(existing) {
  log('\n[wger] fetching muscles')
  const muscles = await fetchAllWgerMuscles()
  const s = stats.wger
  s.muscles = muscles.length
  log(`[wger]   ${muscles.length} muscle(s)`)

  // Media: per-muscle SVG layers + body silhouettes.
  const jobs = []
  for (const m of muscles) {
    if (m.image_url_main) jobs.push({ path: `muscles/main/${m.id}.svg`, url: absoluteWger(m.image_url_main), kind: 'layer' })
    else warn(`wger muscle ${m.id} (${m.name}) has no image_url_main`)
    if (m.image_url_secondary) jobs.push({ path: `muscles/secondary/${m.id}.svg`, url: absoluteWger(m.image_url_secondary), kind: 'layer' })
    else warn(`wger muscle ${m.id} (${m.name}) has no image_url_secondary`)
  }
  for (const [path, url] of Object.entries(WGER_SILHOUETTES)) jobs.push({ path, url, kind: 'silhouette' })

  const present = new Set([...existing].filter((p) => p.startsWith('muscles/')))
  const todo = jobs.filter((j) => !present.has(j.path))
  s.svgsExisting = jobs.length - todo.length
  if (SKIP_MEDIA || DRY_RUN) {
    s.svgsSkipped = todo.length
    log(`[wger] ${DRY_RUN ? 'dry run: would download' : 'media skipped (--skip-media):'} ${todo.length} SVG(s), ${s.svgsExisting} already in bucket`)
  } else {
    log(`[wger] uploading ${todo.length} SVG(s), ${s.svgsExisting} already present`)
    await pMap(todo, CONCURRENCY, async (job) => {
      try {
        const buf = await downloadBinary(job.url, mediaGate, { allow404: job.kind === 'silhouette' })
        if (buf === null) { s.silhouettesMissing++; warn(`silhouette not found (404): ${job.url}`); return }
        if (!looksLikeSvg(buf)) throw new Error('response is not an SVG')
        await uploadToBucket(job.path, buf, 'image/svg+xml')
        present.add(job.path)
        s.svgsUploaded++
        if (job.kind === 'silhouette') s.silhouettesOk++
      } catch (err) {
        s.svgsFailed++
        hardError(`SVG ${job.path}: ${err.message}`)
      }
    })
  }
  for (const path of Object.keys(WGER_SILHOUETTES)) if (existing.has(path)) s.silhouettesOk++

  // Rows.
  const rows = muscles.map((m) => {
    const row = {
      wger_id: m.id,
      name_latin: m.name,
      name_en: (m.name_en && m.name_en.trim()) || m.name,
      is_front: Boolean(m.is_front),
    }
    if (present.has(`muscles/main/${m.id}.svg`)) row.svg_main_path = `muscles/main/${m.id}.svg`
    if (present.has(`muscles/secondary/${m.id}.svg`)) row.svg_secondary_path = `muscles/secondary/${m.id}.svg`
    return row
  })
  if (DRY_RUN) log(`[wger] dry run: would upsert ${rows.length} muscle row(s)`)
  else { s.upserted = await upsertRows('muscles', rows, 'wger_id'); log(`[wger] upserted ${s.upserted} muscle row(s)`) }

  // Aliases.
  const aliases = loadAliases()
  const knownIds = new Set(muscles.map((m) => m.id))
  const aliasRows = []
  for (const [name, wgerId] of Object.entries(aliases)) {
    if (wgerId !== null && !knownIds.has(wgerId)) { hardError(`muscle-aliases.json: "${name}" points to unknown wger id ${wgerId}`); continue }
    aliasRows.push({ exercisedb_name: name, wger_id: wgerId })
  }
  if (DRY_RUN) log(`[wger] dry run: would upsert ${aliasRows.length} alias row(s) (${aliasRows.filter((r) => r.wger_id === null).length} unmapped -> null)`)
  else { s.aliasesApplied = await upsertRows('muscle_aliases', aliasRows, 'exercisedb_name'); log(`[wger] upserted ${s.aliasesApplied} alias row(s)`) }

  await upsertMeta('wger', muscles.length)
}

async function fetchAllWgerMuscles() {
  const out = []
  let url = WGER_MUSCLES_API
  while (url) {
    const page = await fetchJson(new URL(url), mediaGate)
    if (!Array.isArray(page?.results)) throw new Error('wger: unexpected response shape')
    out.push(...page.results)
    url = page.next || null
  }
  return out.sort((a, b) => a.id - b.id)
}

function absoluteWger(u) {
  return /^https?:\/\//i.test(u) ? u : new URL(u, 'https://wger.de').toString()
}

// ---------------------------------------------------------------------------
// Shared: aliases, meta, storage, DB
// ---------------------------------------------------------------------------

function loadAliases() {
  const file = resolve(root, 'scripts/muscle-aliases.json')
  if (!existsSync(file)) { warn('scripts/muscle-aliases.json not found'); return {} }
  const json = JSON.parse(readFileSync(file, 'utf8'))
  const map = json.aliases ?? json
  const out = {}
  for (const [k, v] of Object.entries(map)) {
    if (k.startsWith('_')) continue
    if (v !== null && !Number.isInteger(v)) throw new Error(`muscle-aliases.json: "${k}" must be an integer or null`)
    out[k] = v
  }
  return out
}

async function upsertMeta(source, count) {
  const row = { source, item_count: count, synced_at: new Date().toISOString(), license_text: LICENSE[source] }
  if (DRY_RUN) { log(`[${source}] dry run: would upsert exercise_catalog_meta (${count} items)`); return }
  const { error } = await withRetry(() => supabase.from('exercise_catalog_meta').upsert(row, { onConflict: 'source' }), `meta ${source}`)
  if (error) throw new Error(`exercise_catalog_meta ${source}: ${error.message}`)
  stats.meta++
}

// Lists gifs/, muscles/, muscles/main/, muscles/secondary/ once (pages of 1000) -> Set of paths.
async function listExistingMedia() {
  const set = new Set()
  if (!supabase) return set
  const folders = []
  if (RUN_EXERCISEDB) folders.push('gifs')
  if (RUN_WGER) folders.push('muscles', 'muscles/main', 'muscles/secondary')
  for (const folder of folders) {
    for (let offset = 0; ; offset += STORAGE_PAGE) {
      const { data, error } = await withRetry(
        () => supabase.storage.from(BUCKET).list(folder, { limit: STORAGE_PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
        `list ${folder}`,
      )
      if (error) throw new Error(`storage list ${BUCKET}/${folder}: ${error.message}`)
      for (const obj of data) if (obj.id) set.add(`${folder}/${obj.name}`) // folders (placeholders) have no id
      if (data.length < STORAGE_PAGE) break
    }
  }
  log(`[storage] ${set.size} object(s) already in ${BUCKET}`)
  return set
}

async function uploadToBucket(path, buf, contentType) {
  const { error } = await withRetry(
    () => supabase.storage.from(BUCKET).upload(path, buf, { contentType, upsert: true, cacheControl: '31536000' }),
    `upload ${path}`,
  )
  if (error) throw new Error(`upload ${path}: ${error.message}`)
}

// PostgREST requires every object in a batch to have the same keys, so rows are grouped by
// key signature. Returns the number of rows sent.
async function upsertRows(table, rows, onConflict) {
  const groups = new Map()
  for (const r of rows) { const sig = Object.keys(r).sort().join(','); (groups.get(sig) ?? groups.set(sig, []).get(sig)).push(r) }
  let n = 0
  for (const group of groups.values()) {
    for (const chunk of chunks(group, DB_CHUNK)) {
      const { error } = await withRetry(() => supabase.from(table).upsert(chunk, { onConflict, ignoreDuplicates: false }), `upsert ${table}`)
      if (error) throw new Error(`upsert ${table}: ${error.message}`)
      n += chunk.length
    }
  }
  return n
}

// ---------------------------------------------------------------------------
// HTTP with pacing, Retry-After and exponential backoff
// ---------------------------------------------------------------------------

async function fetchJson(url, gate) {
  const res = await fetchWithRetry(url, gate, { accept: 'application/json' })
  const text = await res.text()
  try { return JSON.parse(text) } catch { throw new Error(`${url}: non-JSON response (${text.slice(0, 80).replace(/\s+/g, ' ')})`) }
}

async function downloadBinary(url, gate, { allow404 = false } = {}) {
  const res = await fetchWithRetry(url, gate, {}, { allow404 })
  if (res.status === 404) return null
  return Buffer.from(await res.arrayBuffer())
}

async function fetchWithRetry(url, gate, headers = {}, { allow404 = false } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    await gate()
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'my-trainer-sync (github.com/bhtyrbyr/my-trainer)', ...headers }, signal: AbortSignal.timeout(60_000) })
      if (res.ok) return res
      if (res.status === 404 && allow404) return res
      lastErr = new Error(`HTTP ${res.status} for ${url}`)
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'))
        const wait = Math.max(Number.isFinite(retryAfter) && retryAfter > 0 ? (retryAfter + 1) * 1000 : 0, backoff(attempt))
        if (attempt < RETRIES) { await sleep(wait); continue }
      }
      throw lastErr
    } catch (err) {
      lastErr = err
      const transient = err.name === 'TimeoutError' || err.name === 'AbortError' || /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(err.message)
      if ((transient || /HTTP (429|5\d\d)/.test(err.message)) && attempt < RETRIES) { await sleep(backoff(attempt)); continue }
      throw err
    }
  }
  throw lastErr
}

async function withRetry(fn, label) {
  let last
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const result = await fn()
      // supabase-js returns { error } instead of throwing; retry only on transport-ish errors.
      const msg = result?.error?.message ?? ''
      if (result?.error && /fetch failed|ECONNRESET|ETIMEDOUT|timeout|503|502|504|too many/i.test(msg) && attempt < RETRIES) { last = result; await sleep(backoff(attempt)); continue }
      return result
    } catch (err) {
      last = { error: err }
      if (attempt < RETRIES) { await sleep(backoff(attempt)); continue }
      throw new Error(`${label}: ${err.message}`)
    }
  }
  return last
}

function backoff(attempt) { return BACKOFF_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 250) }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

// Serialises request starts so that consecutive calls are at least `minInterval` apart.
function makeGate(minInterval) {
  let next = 0
  return async () => {
    const now = Date.now()
    const at = Math.max(now, next)
    next = at + minInterval
    if (at > now) await sleep(at - now)
  }
}

async function pMap(items, concurrency, fn) {
  let i = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx) }
  })
  await Promise.all(workers)
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {}
  for (const a of argv) {
    if (!a.startsWith('--')) fail(`unexpected argument "${a}"`)
    const [k, v] = a.slice(2).split('=')
    out[k] = v === undefined ? true : v
  }
  return out
}

function loadEnvFile(file) {
  if (!existsSync(file)) return
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '')
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (key && !(key in process.env)) process.env[key] = value
  }
}

function capitalize(s) { const t = String(s).trim(); return t.charAt(0).toUpperCase() + t.slice(1) }
function cleanInstruction(s) { return String(s).replace(/^Step:\s*\d+\s*/i, '').trim() }
function looksLikeSvg(buf) { return /<svg[\s>]/i.test(buf.subarray(0, 2048).toString('utf8')) }
function* chunks(arr, size) { for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size) }
function fail(msg) { console.error(`error: ${msg}`); process.exit(1) }

function printSummary() {
  const e = stats.exercisedb, w = stats.wger
  const rows = []
  if (RUN_EXERCISEDB) rows.push(
    ['exercisedb', 'pages fetched', e.pages],
    ['exercisedb', 'exercises (unique)', `${e.unique}${e.fetched !== e.unique ? ` of ${e.fetched} items` : ''}`],
    ['exercisedb', 'exercise rows upserted', DRY_RUN ? `(dry) ${e.unique}` : e.upserted],
    ['exercisedb', 'GIFs already in bucket', e.gifsExisting],
    ['exercisedb', 'GIFs uploaded', e.gifsUploaded],
    ['exercisedb', 'GIFs skipped', e.gifsSkipped],
    ['exercisedb', 'GIFs failed', e.gifsFailed],
    ['exercisedb', 'name_tr applied / already set', `${e.nameTrApplied} / ${e.nameTrAlreadySet}`],
    ['exercisedb', 'name_tr ids not in catalog', e.nameTrMissingIds],
  )
  if (RUN_WGER) rows.push(
    ['wger', 'muscles fetched', w.muscles],
    ['wger', 'muscle rows upserted', DRY_RUN ? `(dry) ${w.muscles}` : w.upserted],
    ['wger', 'SVGs already in bucket', w.svgsExisting],
    ['wger', 'SVGs uploaded', w.svgsUploaded],
    ['wger', 'SVGs skipped', w.svgsSkipped],
    ['wger', 'SVGs failed', w.svgsFailed],
    ['wger', 'silhouettes ok / missing (404)', `${w.silhouettesOk} / ${w.silhouettesMissing}`],
    ['wger', 'alias rows upserted', DRY_RUN ? '(dry)' : w.aliasesApplied],
  )
  if (RUN_EXERCISEDB) rows.push(['wger', 'catalog muscles without alias', w.aliasesUnmapped])
  rows.push(
    ['meta', 'exercise_catalog_meta rows', DRY_RUN ? '(dry)' : stats.meta],
    ['run', 'warnings', warnings.length],
    ['run', 'errors', errors.length],
    ['run', 'duration', `${((Date.now() - startedAt) / 1000).toFixed(1)}s`],
  )
  const w1 = Math.max(...rows.map((r) => r[0].length)), w2 = Math.max(...rows.map((r) => r[1].length))
  const line = `+${'-'.repeat(w1 + 2)}+${'-'.repeat(w2 + 2)}+${'-'.repeat(14)}+`
  console.log(`\n${line}`)
  for (const [a, b, c] of rows) console.log(`| ${a.padEnd(w1)} | ${b.padEnd(w2)} | ${String(c).padStart(12)} |`)
  console.log(line)
  if (errors.length) console.log(`\n${errors.length} error(s): exit code 1`)
  else console.log(DRY_RUN ? '\nDry run complete: nothing was written.' : '\nSync complete.')
}
