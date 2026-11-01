#!/usr/bin/env node
// Exercise catalog v2 sync: openly licensed exercises from wger and workout-guide into
// public.exercises (+ SVG frames in the private `exercise-media` bucket, `exercise_catalog_meta`),
// ExerciseDB ids for hot-linked GIFs, AI-written instructions where the source has none, Turkish
// instructions. Contract: docs/catalog-v2-spec.md. Licences: docs/LICENSING.md.
//
// Sources (pinned)
//   wger          https://wger.de/api/v2/exerciseinfo/  text CC BY-SA 3/4 or CC0 per entry (license_author)
//   workout-guide https://github.com/bryllim/workout-guide  pinned to commit
//                 aac599224bb9780305239607ef98540b7e0ce389 (commit of 2026-08-26, pinned 2026-10-30):
//                 302 exercises x 3 SVG frames, CC BY-SA 4.0 (76 first frames traced from Everkinetic);
//                 manifest metadata MIT. Bump WG_SHA deliberately and re-run with --force-media.
//   ExerciseDB    https://oss.exercisedb.dev/api/v1/exercises?limit=25&after=<cursor>  id matching only (owner decision 2026-11-02):
//                 the app hot-links https://static.exercisedb.dev/media/<id>.gif; only the id is stored.
//                 ExerciseDB names/text/media stay in memory (never written to the DB or committed files).
//
// Usage
//   node scripts/sync-catalog.mjs --dry-run                fetch, select, map, deterministic ExerciseDB match;
//                                                          writes scripts/out/catalog-plan.json and
//                                                          scripts/out/exercisedb-match.json; no DB writes
//   node scripts/sync-catalog.mjs                          upsert rows, frames, meta, then Gemini steps
//   node scripts/sync-catalog.mjs --translate-limit=N      max Gemini Flash Lite requests this run for all AI steps
//                                                          together (match 20/req, generate 10/req, translate
//                                                          20/req); default 30, 0 = no AI
//   node scripts/sync-catalog.mjs --skip-exercisedb        no ExerciseDB fetch or matching
//   node scripts/sync-catalog.mjs --exercisedb-file=PATH   read the ExerciseDB list from a local JSON array of
//                                                          {id,name,eq,bp,t[,s]} (development) instead of the API
//   node scripts/sync-catalog.mjs --skip-media             rows only (keeps media_frames already set)
//   node scripts/sync-catalog.mjs --force-media            re-upload every frame (after a WG_SHA bump)
//
// Credentials (never committed; `*.local` is gitignored)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  GitHub Secrets in CI, or ./.env.sync.local locally
//   GEMINI_API_KEY                           optional; AI steps are skipped without it
//   GEMINI_LITE_MODEL                        optional, default gemini-3.5-flash-lite; must be a Flash Lite model
// The service role is used only here, server-side (CLAUDE.md rule 3); third-party APIs are called only
// from scripts/* (rule 4).
//
// Behaviour
//   - Idempotent: rows upserted by external_id (`wger:<uuid>`, `wg:<slug>`). Names are English only:
//     name_tr is never written. instructions_tr is never overwritten.
//   - media_frames is only set once every frame of the row is in the bucket; an earlier value is never nulled.
//   - Order of the AI steps: ExerciseDB match (exact, fuzzy, then Gemini for the rest), generate missing
//     instructions (EN + TR), translate instructions_tr. Rows with exercisedb_match = 'manual' are never touched.
//   - Gemini keeps the user reserve: liteBudget() = Flash Lite RPD (app_config.ai_model_limits) minus
//     today's (Pacific day) ai_usage_log rows minus 100; every request is logged (429s are not logged, as
//     Google does not count them); a 429 stops all AI steps for the run.
//   - Exit code 1 if any hard failure happened (the run still completes so progress is kept).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  AI_GENERATED,
  EDB_ID_RE,
  EDB_MATCH_BATCH,
  EDB_MATCH_SCHEMA,
  GENERATE_BATCH,
  GENERATE_SCHEMA,
  INSTRUCTIONS_TR_SCHEMA,
  MACHINE_TRANSLATION,
  TRANSLATE_BATCH,
  buildCatalog,
  buildEdbMatchPrompt,
  buildGeneratePrompt,
  buildInstructionsTranslatePrompt,
  checkCoreLifts,
  edbCandidates,
  isFlashLite,
  isSafeSvg,
  matchExerciseDb,
  mergeAttribution,
  normalizeEdbRow,
  pacificDay,
  pickInstructionExamples,
  validateEdbMatches,
  validateGenerated,
  validateInstructionTranslations,
  withChange,
} from './catalog-lib.mjs'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WG_SHA = 'aac599224bb9780305239607ef98540b7e0ce389'
const WG_MANIFEST = `https://raw.githubusercontent.com/bryllim/workout-guide/${WG_SHA}/packages/workout-guide/manifest.json`
const WGER = 'https://wger.de/api/v2'
const EDB_API = 'https://oss.exercisedb.dev/api/v1/exercises'
const EDB_MIN_INTERVAL_MS = 2500 // Cloudflare in front of the free API rate-limits hard
const EDB_MAX_BACKOFF_MS = 120_000 // per page, total
const EDB_PAGE_SIZE = 25 // the API caps `limit` at 25
const EDB_MAX_PAGES = 100 // 1500 rows = 60 pages
const USER_AGENT = 'my-trainer-sync (github.com/bhtyrbyr/my-trainer; monthly catalog sync)'
const BUCKET = 'exercise-media'
const RETRIES = 3
const BACKOFF_BASE_MS = 1000
const API_MIN_INTERVAL_MS = 1100
const MEDIA_MIN_INTERVAL_MS = 150
const GEMINI_MIN_INTERVAL_MS = 4500 // Flash Lite free tier: 15 RPM
const USER_RESERVE = 100
// ai_usage_log.action has a check constraint; all catalog requests are logged under the existing value.
const AI_LOG_ACTION = 'catalog_translate'
const DB_CHUNK = 200
const MAX_MEDIA_BYTES = 5 * 1024 * 1024
const CATALOG_SOURCES = ['wger', 'workout-guide']
const META = {
  'wger-exercises': 'Exercise text: wger contributors (https://wger.de), CC BY-SA 3.0/4.0 or CC0 per exercise; illustrations from wger only where Everkinetic, AI-generated or Wikimedia.',
  'workout-guide': `Exercise illustrations: workout-guide by Bryl Lim (${WG_SHA.slice(0, 7)}), CC BY-SA 4.0, partly adapted from Everkinetic (CC BY-SA 4.0); metadata MIT. https://github.com/bryllim/workout-guide`,
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const OUT = resolve(root, 'scripts/out')
const PLAN_FILE = resolve(OUT, 'catalog-plan.json')
const MATCH_FILE = resolve(OUT, 'exercisedb-match.json')

// ---------------------------------------------------------------------------
// CLI + env
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 50).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(0)
}
const DRY_RUN = Boolean(args['dry-run'])
const SKIP_MEDIA = Boolean(args['skip-media'])
const FORCE_MEDIA = Boolean(args['force-media'])
const SKIP_EDB = Boolean(args['skip-exercisedb'])
const EDB_FILE = typeof args['exercisedb-file'] === 'string' ? resolve(process.cwd(), args['exercisedb-file']) : null
const CONCURRENCY = Math.max(1, Number(args.concurrency ?? 4) || 4)
const AI_LIMIT = Math.max(0, Math.floor(Number(args['translate-limit'] ?? 30)))
if (!Number.isFinite(AI_LIMIT)) fail('--translate-limit must be a number')

loadEnvFile(resolve(root, '.env.sync.local'))
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const GEMINI_KEY = process.env.GEMINI_API_KEY
const GEMINI_MODEL = process.env.GEMINI_LITE_MODEL || 'gemini-3.5-flash-lite'
const HAS_CREDS = Boolean(SUPABASE_URL && SERVICE_KEY)
if (!DRY_RUN && !HAS_CREDS) {
  fail('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (environment or ./.env.sync.local). Use --dry-run to plan without credentials.')
}
const supabase = HAS_CREDS ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null

// ---------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------

const startedAt = Date.now()
const stats = {
  framesKept: 0,
  framesUploaded: 0,
  framesFailed: 0,
  rowsWithMedia: 0,
  upserted: 0,
  stale: 0,
  edbRows: 0,
  edbExact: 0,
  edbFuzzy: 0,
  edbAi: 0,
  edbKeptAi: 0,
  edbManual: 0,
  edbUnmatched: 0,
  edbUpdated: 0,
  aiRequests: 0,
  generated: 0,
  generateRejected: 0,
  translated: 0,
  translateRejected: 0,
  matchRejected: 0,
}
const warnings = []
const errors = []
const log = (msg) => console.log(msg)
const warn = (msg) => { warnings.push(msg); console.warn(`  ! ${msg}`) }
const hardError = (msg) => { errors.push(msg); console.error(`  x ${msg}`) }

const apiGate = makeGate(API_MIN_INTERVAL_MS)
const mediaGate = makeGate(MEDIA_MIN_INTERVAL_MS)
const geminiGate = makeGate(GEMINI_MIN_INTERVAL_MS)
const edbGate = makeGate(EDB_MIN_INTERVAL_MS)

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

try {
  log(`sync-catalog  mode=${DRY_RUN ? 'DRY RUN' : 'write'}  credentials=${HAS_CREDS ? 'yes' : 'no'}  workout-guide@${WG_SHA.slice(0, 7)}`)
  await sync()
  process.exitCode = errors.length ? 1 : 0
} catch (err) {
  hardError(err?.stack || String(err))
  process.exitCode = 1
}
printSummary()

async function sync() {
  // 1. Sources
  log('\n[wger] fetching languages, licences and exerciseinfo')
  const enId = await fetchEnglishId()
  const licenses = await fetchLicenses()
  const wgerResults = await fetchPaged(`${WGER}/exerciseinfo/?limit=100&offset=0`)
  log(`[wger]   ${wgerResults.length} exercise(s)`)
  log(`[workout-guide] fetching manifest @ ${WG_SHA}`)
  const wgManifest = await fetchJson(WG_MANIFEST, apiGate)
  if (!Array.isArray(wgManifest) || !wgManifest.every((e) => e?.slug && e?.name && Array.isArray(e.frames))) throw new Error('workout-guide: unexpected manifest shape')
  log(`[workout-guide]   ${wgManifest.length} exercise(s)`)

  // 2. Selection + mapping
  const catalog = buildCatalog({ wgerResults, licenses, enId, wgManifest, sha: WG_SHA })
  const rows = catalog.rows
  const core = checkCoreLifts(rows)
  const missingCore = core.filter((c) => !c.ok)
  if (missingCore.length) warn(`core lift(s) missing from the selection: ${missingCore.map((c) => c.lift).join(', ')}`)
  log(`[select] ${rows.length} exercise(s): ${catalog.stats.wgerSelected} wger + ${catalog.stats.wgAdded} workout-guide-only; ${catalog.stats.wgMatchedToWger} workout-guide entries lend frames to wger rows`)
  writePlan({ catalog, core, licenses })

  // 3. ExerciseDB list (memory only)
  const edbRows = SKIP_EDB ? null : await loadExerciseDb()

  if (DRY_RUN) {
    if (edbRows) {
      const { matches, pending } = matchExerciseDb(rows, edbRows)
      writeMatchReport(rows, edbRows, matches, pending)
    }
    return
  }

  // 4. Existing rows (media, attribution notes, generated instructions and matches survive re-syncs)
  const existing = await fetchExisting()
  const selectedIds = new Set(rows.map((r) => r.external_id))
  stats.stale = [...existing.keys()].filter((id) => !selectedIds.has(id)).length
  if (stats.stale) warn(`${stats.stale} catalog row(s) from wger/workout-guide are no longer selected; left untouched`)

  // 5. Media
  const mediaFor = await syncMedia(rows, existing)

  // 6. Rows
  const out = rows.map((r) => {
    const prev = existing.get(r.external_id)
    const prevGenerated = (prev?.attribution?.changes ?? []).includes(AI_GENERATED)
    const sourceHasText = r.instructions_en.length > 0
    const row = {
      external_id: r.external_id,
      source: r.source,
      is_custom: false,
      name_en: r.name_en,
      body_parts: r.body_parts,
      target_muscles: r.target_muscles,
      secondary_muscles: r.secondary_muscles,
      equipment: r.equipment,
      attribution: mergeAttribution(r.attribution, prev?.attribution, { keepGenerated: !sourceHasText, keepTranslation: !(sourceHasText && prevGenerated) }),
    }
    // Source text wins; an empty source never wipes instructions generated by an earlier run.
    if (sourceHasText || !(prev?.instructions_en ?? []).length) row.instructions_en = r.instructions_en
    // The source now has its own text: the Turkish of the generated steps no longer fits.
    if (sourceHasText && prevGenerated) row.instructions_tr = null
    if (mediaFor.has(r.external_id)) row.media_frames = mediaFor.get(r.external_id)
    return row
  })
  stats.upserted = await upsertRows('exercises', out, 'external_id')
  log(`[db] upserted ${stats.upserted} exercise row(s)`)

  // 7. Meta
  const counts = { 'wger-exercises': rows.filter((r) => r.source === 'wger').length, 'workout-guide': rows.filter((r) => r.source === 'workout-guide').length }
  for (const [source, count] of Object.entries(counts)) {
    const { error } = await withRetry(() => supabase.from('exercise_catalog_meta').upsert({ source, item_count: count, synced_at: new Date().toISOString(), license_text: META[source] }, { onConflict: 'source' }), `meta ${source}`)
    if (error) hardError(`exercise_catalog_meta ${source}: ${error.message}`)
  }

  // 8. ExerciseDB ids (deterministic, then Gemini), 9. missing instructions, 10. Turkish instructions
  if (edbRows && existing.edbColumns) await syncExerciseDb(rows, edbRows, existing)
  else if (edbRows) warn('[exercisedb] exercises.exercisedb_id is missing (migration not applied?); matching skipped')
  await generateMissing()
  await translateMissing()
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

async function fetchEnglishId() {
  const langs = await fetchPaged(`${WGER}/language/?limit=100`)
  const en = langs.find((l) => l.short_name === 'en')
  if (!en) throw new Error('wger: English language id not found')
  return en.id
}

async function fetchLicenses() {
  const list = await fetchPaged(`${WGER}/license/?limit=100`)
  return Object.fromEntries(list.map((l) => [l.id, { short_name: l.short_name, url: l.url }]))
}

async function fetchPaged(start) {
  const out = []
  let url = start
  const seen = new Set()
  while (url) {
    if (seen.has(url)) throw new Error(`wger: pagination loop at ${url}`)
    seen.add(url)
    const page = await fetchJson(url, apiGate)
    if (!Array.isArray(page?.results)) throw new Error(`wger: unexpected response shape at ${url}`)
    out.push(...page.results)
    url = page.next || null
  }
  return out
}

/** ExerciseDB list from --exercisedb-file or the paced v1 API; null (matching skipped) on failure. */
async function loadExerciseDb() {
  try {
    let raw
    if (EDB_FILE) {
      if (!existsSync(EDB_FILE)) throw new Error(`${EDB_FILE} not found`)
      raw = JSON.parse(readFileSync(EDB_FILE, 'utf8'))
      if (!Array.isArray(raw)) throw new Error(`${EDB_FILE}: expected a JSON array`)
      log(`\n[exercisedb] ${raw.length} row(s) from ${EDB_FILE}`)
    } else {
      log('\n[exercisedb] fetching the v1 list (paced)')
      raw = await fetchExerciseDbApi()
    }
    const byId = new Map()
    for (const e of raw) {
      const n = normalizeEdbRow(e)
      if (n && !byId.has(n.id)) byId.set(n.id, n)
    }
    const list = [...byId.values()]
    if (list.length < 500) throw new Error(`only ${list.length} usable row(s); refusing to match against a partial list`)
    stats.edbRows = list.length
    log(`[exercisedb]   ${list.length} usable row(s)`)
    return list
  } catch (err) {
    // Matching is skipped, nothing is cleared: existing ids stay as they are.
    warn(`[exercisedb] list unavailable, matching skipped: ${err.message}`)
    return null
  }
}

async function fetchExerciseDbApi() {
  // Keyset pagination: `after=<meta.nextCursor>` (the last id of the page); a `cursor` parameter is ignored.
  const out = []
  const ids = new Set()
  let after = null
  let total = null
  for (let page = 0; ; page++) {
    if (page >= EDB_MAX_PAGES) throw new Error(`more than ${EDB_MAX_PAGES} pages`)
    const url = `${EDB_API}?limit=${EDB_PAGE_SIZE}${after ? `&after=${encodeURIComponent(after)}` : ''}`
    const json = await fetchEdbPage(url)
    const fresh = json.data.filter((e) => e?.exerciseId && !ids.has(e.exerciseId))
    if (json.data.length && !fresh.length) throw new Error(`pagination loop after ${after}`)
    for (const e of fresh) { ids.add(e.exerciseId); out.push(e) }
    total = Number(json.meta?.total) || total
    const next = json.meta?.hasNextPage ? json.meta?.nextCursor : null
    if (!next) break
    after = next
    if ((page + 1) % 10 === 0) log(`[exercisedb]   ${out.length}${total ? `/${total}` : ''}`)
  }
  if (total && out.length < total * 0.95) throw new Error(`incomplete list (${out.length}/${total})`)
  return out
}

/** One page; retries 429 / 5xx / non-JSON (Cloudflare HTML) with exponential backoff, ~2 min in total. */
async function fetchEdbPage(url) {
  let waited = 0
  for (let attempt = 0; ; attempt++) {
    await edbGate()
    let status = 0
    let body = ''
    let retryAfter = 0
    try {
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
      status = res.status
      retryAfter = Number(res.headers.get('retry-after')) || 0
      body = await res.text()
      if (res.ok) {
        try {
          const json = JSON.parse(body)
          if (json?.success && Array.isArray(json.data)) return json
          body = 'unexpected JSON shape'
        } catch { /* Cloudflare HTML page */ }
      } else if (status !== 429 && status < 500) throw Object.assign(new Error(`HTTP ${status}`), { fatal: true })
    } catch (err) {
      if (err.fatal) throw new Error(`${url}: ${err.message}`)
      body = err.message
    }
    const wait = Math.max(retryAfter * 1000, 3000 * 2 ** attempt) + Math.floor(Math.random() * 500)
    if (waited + wait > EDB_MAX_BACKOFF_MS) throw new Error(`${url}: gave up after ${attempt + 1} attempt(s) (last: ${status || 'network'} ${body.slice(0, 60).replace(/\s+/g, ' ')})`)
    waited += wait
    log(`[exercisedb]   ${status || 'network error'}${status === 200 ? ' non-JSON' : ''}; retry in ${Math.round(wait / 1000)} s`)
    await sleep(wait)
  }
}

function writePlan({ catalog, core, licenses }) {
  mkdirSync(OUT, { recursive: true })
  const rows = catalog.rows
  const byBodyPart = countBy(rows.flatMap((r) => r.body_parts))
  const byEquipment = countBy(rows.flatMap((r) => (r.equipment.length ? r.equipment : ['(none)'])))
  const plan = {
    generated_at: new Date().toISOString(),
    sources: {
      wger: { api: `${WGER}/exerciseinfo/`, licenses },
      workout_guide: { repo: 'https://github.com/bryllim/workout-guide', commit: WG_SHA, pinned_on: '2026-10-30', commit_date: '2026-08-26' },
    },
    stats: { ...catalog.stats, bySource: countBy(rows.map((r) => r.source)), byBodyPart, byEquipment, withoutInstructions: rows.filter((r) => !r.instructions_en.length).length },
    core_lifts: core,
    no_equipment_term: rows.filter((r) => !r.equipment.length).map((r) => r.name_en),
    dropped: catalog.dropped,
    workout_guide_matched_to_wger: catalog.wgMatched,
    exercises: rows.map(({ _frames, _origin, ...r }) => ({
      ...r,
      media_frames: _frames.map((f) => f.storage),
      media_sources: _frames.map((f) => f.url),
      origin: _origin,
    })),
  }
  writeFileSync(PLAN_FILE, `${JSON.stringify(plan, null, 2)}\n`)
  log(`[out] ${rel(PLAN_FILE)} (${rows.length} exercises, ${plan.stats.withoutInstructions} without instructions)`)
}

/** Dry-run report (scripts/out is gitignored; ExerciseDB names appear only in this local file). */
function writeMatchReport(rows, edbRows, matches, pending) {
  const edbById = new Map(edbRows.map((e) => [e.id, e]))
  const counts = { total: rows.length, exact: 0, fuzzy: 0, pending_ai: pending.length }
  const pairs = []
  for (const r of rows) {
    const m = matches.get(r.external_id)
    if (!m) continue
    counts[m.method]++
    const e = edbById.get(m.id)
    pairs.push({ external_id: r.external_id, name: r.name_en, equipment: r.equipment, method: m.method, score: m.score ?? null, exercisedb_id: m.id, exercisedb_name: e.name, exercisedb_equipment: e.equipment })
  }
  const report = {
    generated_at: new Date().toISOString(),
    note: 'Local review file (gitignored). Deterministic matches only; pending rows go to the Gemini step in a write run.',
    counts,
    matches: pairs,
    unmatched_before_ai: pending.map((r) => ({
      external_id: r.external_id,
      name: r.name_en,
      equipment: r.equipment,
      body_parts: r.body_parts,
      candidates: edbCandidates(r, edbRows).map((c) => `${c.id} ${c.name} [${c.equipment.join(', ')}]`),
    })),
  }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(MATCH_FILE, `${JSON.stringify(report, null, 2)}\n`)
  log(`[exercisedb] exact ${counts.exact}, fuzzy ${counts.fuzzy}, unmatched before AI ${counts.pending_ai} (of ${counts.total})`)
  log(`[out] ${rel(MATCH_FILE)}`)
  stats.edbExact = counts.exact
  stats.edbFuzzy = counts.fuzzy
  stats.edbUnmatched = counts.pending_ai
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

async function syncMedia(rows, existing) {
  const result = new Map() // external_id -> media_frames to write
  const withFrames = rows.filter((r) => r._frames.length)
  const uploads = new Map() // storage path -> Promise<boolean>
  const todo = []
  for (const r of withFrames) {
    const paths = r._frames.map((f) => f.storage)
    const prev = existing.get(r.external_id)?.media_frames ?? []
    if (!FORCE_MEDIA && sameList(prev, paths)) {
      result.set(r.external_id, paths)
      stats.framesKept += paths.length
    } else if (SKIP_MEDIA) {
      // keep whatever is there
    } else todo.push(r)
  }
  if (SKIP_MEDIA) { log(`[media] skipped (--skip-media); ${result.size} row(s) already have their frames`); return result }
  log(`[media] ${todo.length} row(s) need frames, ${result.size} already complete`)
  let done = 0
  await pMap(todo, CONCURRENCY, async (r) => {
    const oks = await Promise.all(r._frames.map((f) => {
      if (!uploads.has(f.storage)) uploads.set(f.storage, uploadFrame(f))
      return uploads.get(f.storage)
    }))
    if (oks.every(Boolean)) result.set(r.external_id, r._frames.map((f) => f.storage))
    done++
    if (done % 50 === 0 || done === todo.length) log(`[media]   ${done}/${todo.length} rows (${stats.framesUploaded} frames uploaded, ${stats.framesFailed} failed)`)
  })
  stats.rowsWithMedia = result.size
  return result
}

async function uploadFrame(f) {
  try {
    const buf = await downloadBinary(f.url, mediaGate)
    if (buf.length > MAX_MEDIA_BYTES) throw new Error(`too large (${buf.length} bytes)`)
    if (f.contentType === 'image/svg+xml') {
      if (!isSafeSvg(buf.toString('utf8'))) throw new Error('SVG rejected (not an SVG or contains active content)')
    } else if (f.contentType === 'image/png') {
      if (buf.subarray(1, 4).toString('latin1') !== 'PNG') throw new Error('response is not a PNG')
    } else if (f.contentType === 'image/webp') {
      if (buf.subarray(8, 12).toString('latin1') !== 'WEBP') throw new Error('response is not a WebP')
    } else throw new Error(`unsupported type ${f.contentType}`)
    const { error } = await withRetry(() => supabase.storage.from(BUCKET).upload(f.storage, buf, { contentType: f.contentType, upsert: true, cacheControl: '31536000' }), `upload ${f.storage}`)
    if (error) throw new Error(error.message)
    stats.framesUploaded++
    return true
  } catch (err) {
    stats.framesFailed++
    // an oversized source image only costs that row its picture (it falls back to the muscle map)
    if (/too large/.test(err.message)) warn(`frame ${f.storage} skipped: ${err.message}`)
    else hardError(`frame ${f.storage} (${f.url}): ${err.message}`)
    return false
  }
}

// ---------------------------------------------------------------------------
// ExerciseDB ids
// ---------------------------------------------------------------------------

async function syncExerciseDb(rows, edbRows, existing) {
  const edbIds = new Set(edbRows.map((e) => e.id))
  const manual = new Set([...existing].filter(([, x]) => x.exercisedb_match === 'manual').map(([id]) => id))
  stats.edbManual = manual.size
  const { matches, pending } = matchExerciseDb(rows, edbRows, { skip: manual })
  const want = new Map() // external_id -> { id, method } | null
  for (const [externalId, m] of matches) want.set(externalId, { id: m.id, method: m.method })

  // An earlier AI answer stays while its id still exists; only new or invalid rows are asked again.
  const ask = []
  for (const r of pending) {
    const prev = existing.get(r.external_id)
    if (prev?.exercisedb_match === 'ai' && edbIds.has(prev.exercisedb_id)) { want.set(r.external_id, { id: prev.exercisedb_id, method: 'ai' }); stats.edbKeptAi++ } else ask.push(r)
  }
  const byMethod = countBy([...matches.values()].map((m) => m.method))
  log(`[exercisedb] exact ${byMethod.exact ?? 0}, fuzzy ${byMethod.fuzzy ?? 0}, earlier AI kept ${stats.edbKeptAi}, manual ${manual.size}, to ask Gemini ${ask.length}`)

  const asked = new Set()
  for (let i = 0; i < ask.length; i += EDB_MATCH_BATCH) {
    if (!(await aiAvailable('exercisedb'))) break
    const items = ask.slice(i, i + EDB_MATCH_BATCH).map((row) => ({ row, candidates: edbCandidates(row, edbRows) }))
    let output
    try {
      output = await geminiJson(buildEdbMatchPrompt(items), EDB_MATCH_SCHEMA, 0)
    } catch (err) {
      if (aiFailed('exercisedb', err)) break
      continue
    }
    const { accepted, rejected } = validateEdbMatches(items, output)
    stats.matchRejected += rejected.length
    for (const r of rejected) warn(`[exercisedb] ${r.id}: ${r.reason}`)
    for (const a of accepted) {
      asked.add(a.id)
      want.set(a.id, a.match ? { id: a.match, method: 'ai' } : null)
    }
    log(`[exercisedb] Gemini request ${stats.aiRequests}: ${accepted.filter((a) => a.match).length}/${items.length} matched`)
  }

  // Rows that were not asked (budget, errors) keep what they have.
  for (const r of ask) if (!asked.has(r.external_id)) want.delete(r.external_id)

  const changes = []
  for (const r of rows) {
    if (manual.has(r.external_id) || !want.has(r.external_id)) continue
    const w = want.get(r.external_id)
    const prev = existing.get(r.external_id) ?? {}
    const next = { exercisedb_id: w?.id ?? null, exercisedb_match: w?.method ?? null }
    if (next.exercisedb_id !== null && !EDB_ID_RE.test(next.exercisedb_id)) continue
    if ((prev.exercisedb_id ?? null) === next.exercisedb_id && (prev.exercisedb_match ?? null) === next.exercisedb_match) continue
    changes.push([r.external_id, next])
  }
  await pMap(changes, CONCURRENCY, async ([externalId, patch]) => {
    // The filter keeps a manual match set in the meantime.
    const { data, error } = await withRetry(() => supabase.from('exercises').update(patch).eq('external_id', externalId).or('exercisedb_match.is.null,exercisedb_match.neq.manual').select('id'), `exercisedb ${externalId}`)
    if (error) hardError(`[exercisedb] update ${externalId}: ${error.message}`)
    else stats.edbUpdated += data?.length ?? 0
  })
  for (const r of rows) {
    if (manual.has(r.external_id)) continue
    const w = want.has(r.external_id) ? want.get(r.external_id) : existing.get(r.external_id)?.exercisedb_match ? { method: existing.get(r.external_id).exercisedb_match } : null
    if (!w) stats.edbUnmatched++
    else if (w.method === 'exact') stats.edbExact++
    else if (w.method === 'fuzzy') stats.edbFuzzy++
    else if (w.method === 'ai') stats.edbAi++
  }
  log(`[exercisedb] ${stats.edbUpdated} row(s) updated; exact ${stats.edbExact}, fuzzy ${stats.edbFuzzy}, ai ${stats.edbAi}, manual ${stats.edbManual}, unmatched ${stats.edbUnmatched}`)
}

// ---------------------------------------------------------------------------
// Gemini Flash Lite: shared budget, generation, translation
// ---------------------------------------------------------------------------

let aiStopped = null // reason; set once, ends every AI step of the run

async function liteBudget() {
  const { data: cfg, error: e1 } = await supabase.from('app_config').select('value').eq('key', 'ai_model_limits').maybeSingle()
  if (e1) throw new Error(`app_config: ${e1.message}`)
  const rpd = Number(cfg?.value?.[GEMINI_MODEL]?.rpd ?? 500)
  const { count, error: e2 } = await supabase.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('model', GEMINI_MODEL).eq('day_pt', pacificDay())
  if (e2) throw new Error(`ai_usage_log: ${e2.message}`)
  return rpd - (count ?? 0) - USER_RESERVE
}

/** True when one more Gemini request may be sent now; logs why not (once per step). */
async function aiAvailable(step) {
  if (!aiStopped) {
    if (AI_LIMIT === 0) aiStopped = 'disabled (--translate-limit=0)'
    else if (!GEMINI_KEY) aiStopped = 'GEMINI_API_KEY not set'
    else if (!isFlashLite(GEMINI_MODEL)) { hardError(`${GEMINI_MODEL} is not a Flash Lite model; refusing to call Gemini`); aiStopped = 'model is not Flash Lite' }
    else if (stats.aiRequests >= AI_LIMIT) return logStop(step, `request limit of ${AI_LIMIT} reached; the next run continues`)
    else if ((await liteBudget()) <= 0) aiStopped = `keeping ${USER_RESERVE} ${GEMINI_MODEL} requests for users today; the next run continues`
  }
  return aiStopped ? logStop(step, aiStopped) : true
}

const stopLogged = new Set()
function logStop(step, reason) {
  if (!stopLogged.has(step)) { stopLogged.add(step); log(`[${step}] AI paused: ${reason}`) }
  return false
}

/** Handles a failed request; returns true when the step should stop. */
const failures = { count: 0 }
function aiFailed(step, err) {
  if (err.status === 429) { aiStopped = 'Gemini quota reached (429)'; warn(`[${step}] Gemini quota reached (429); AI steps stop for this run`); return true }
  failures.count++
  hardError(`[${step}] Gemini request failed: ${err.message}`)
  if (failures.count >= 3) { aiStopped = 'three failed Gemini requests'; return true }
  return false
}

async function catalogRows() {
  return selectAll('exercises', 'external_id,source,name_en,body_parts,target_muscles,secondary_muscles,equipment,instructions_en,instructions_tr,attribution', (q) => q.in('source', CATALOG_SOURCES).order('external_id'))
}

async function generateMissing() {
  if (aiStopped || AI_LIMIT === 0 || !GEMINI_KEY) return
  const all = await catalogRows()
  const todo = all
    .filter((r) => !(r.instructions_en ?? []).length)
    .sort((a, b) => String(a.body_parts?.[0] ?? '').localeCompare(String(b.body_parts?.[0] ?? '')) || a.external_id.localeCompare(b.external_id))
  log(`[generate] ${todo.length} row(s) without instructions; batches of ${GENERATE_BATCH}`)
  for (let i = 0; i < todo.length; i += GENERATE_BATCH) {
    if (!(await aiAvailable('generate'))) break
    const batch = todo.slice(i, i + GENERATE_BATCH)
    const bodyParts = [...new Set(batch.flatMap((r) => r.body_parts ?? []))]
    const examples = pickInstructionExamples(all, bodyParts, 4)
    const items = batch.map((r) => ({ id: r.external_id, name_en: r.name_en, equipment: r.equipment, body_parts: r.body_parts, target_muscles: r.target_muscles, secondary_muscles: r.secondary_muscles }))
    let output
    try {
      output = await geminiJson(buildGeneratePrompt(items, examples), GENERATE_SCHEMA, 0.3)
    } catch (err) {
      if (aiFailed('generate', err)) break
      continue
    }
    const { accepted, rejected } = validateGenerated(items, output)
    stats.generateRejected += rejected.length
    for (const r of rejected) warn(`[generate] ${r.id}: ${r.reason}`)
    const byId = new Map(batch.map((r) => [r.external_id, r]))
    for (const g of accepted) {
      const row = byId.get(g.id)
      const patch = { instructions_en: g.en, attribution: withChange(row.attribution, AI_GENERATED) }
      if (!(row.instructions_tr ?? []).length) {
        patch.instructions_tr = g.tr
        patch.attribution = withChange(patch.attribution, MACHINE_TRANSLATION)
      }
      // Only while the row is still empty (never replaces text written meanwhile).
      const { data, error } = await withRetry(() => supabase.from('exercises').update(patch).eq('external_id', g.id).eq('instructions_en', '{}').select('id'), `generate ${g.id}`)
      if (error) { hardError(`[generate] update ${g.id}: ${error.message}`); continue }
      stats.generated += data?.length ?? 0
    }
    log(`[generate] request ${stats.aiRequests}: ${accepted.length}/${items.length} accepted (total ${stats.generated})`)
  }
}

async function translateMissing() {
  if (aiStopped || AI_LIMIT === 0 || !GEMINI_KEY) {
    if (!GEMINI_KEY) log('[translate] GEMINI_API_KEY not set: Turkish instructions stay empty for now')
    return
  }
  const all = await catalogRows()
  const todo = all.filter((r) => r.instructions_tr == null && (r.instructions_en ?? []).length)
  log(`[translate] ${todo.length} row(s) need Turkish instructions; batches of ${TRANSLATE_BATCH}`)
  for (let i = 0; i < todo.length; i += TRANSLATE_BATCH) {
    if (!(await aiAvailable('translate'))) break
    const batch = todo.slice(i, i + TRANSLATE_BATCH)
    const items = batch.map((r) => ({ id: r.external_id, name_en: r.name_en, instructions_en: r.instructions_en }))
    let output
    try {
      output = await geminiJson(buildInstructionsTranslatePrompt(items), INSTRUCTIONS_TR_SCHEMA, 0.1)
    } catch (err) {
      if (aiFailed('translate', err)) break
      continue
    }
    const { accepted, rejected } = validateInstructionTranslations(items, output)
    stats.translateRejected += rejected.length
    for (const r of rejected) warn(`[translate] ${r.id}: ${r.reason}`)
    const byId = new Map(batch.map((r) => [r.external_id, r]))
    for (const t of accepted) {
      const patch = { instructions_tr: t.instructions_tr, attribution: withChange(byId.get(t.id).attribution, MACHINE_TRANSLATION) }
      const { data, error } = await withRetry(() => supabase.from('exercises').update(patch).eq('external_id', t.id).is('instructions_tr', null).select('id'), `translate ${t.id}`)
      if (error) { hardError(`[translate] update ${t.id}: ${error.message}`); continue }
      stats.translated += data?.length ?? 0
    }
    log(`[translate] request ${stats.aiRequests}: ${accepted.length}/${items.length} accepted (total ${stats.translated})`)
  }
}

async function geminiJson(prompt, schema, temperature) {
  await geminiGate()
  stats.aiRequests++
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema },
    }),
    signal: AbortSignal.timeout(90_000),
  })
  if (res.status === 429) {
    const err = new Error('gemini 429')
    err.status = 429
    throw err
  }
  const data = res.ok ? await res.json() : null
  const u = data?.usageMetadata ?? {}
  // Counts only, for the admin AI usage dashboard and liteBudget(); system rows have no user.
  const { error: logErr } = await supabase.from('ai_usage_log').insert({
    user_id: null,
    action: AI_LOG_ACTION,
    provider: 'gemini',
    model: GEMINI_MODEL,
    prompt_tokens: u.promptTokenCount ?? 0,
    output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    total_tokens: u.totalTokenCount ?? 0,
    ok: res.ok,
  })
  if (logErr) hardError(`ai_usage_log insert: ${logErr.message}`)
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''))
  } catch {
    throw new Error(`gemini returned non-JSON (${text.slice(0, 80)})`)
  }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function fetchExisting() {
  const base = 'external_id,media_frames,attribution,instructions_en,instructions_tr'
  let rows
  let edbColumns = true
  try {
    rows = await selectAll('exercises', `${base},exercisedb_id,exercisedb_match`, (q) => q.in('source', CATALOG_SOURCES))
  } catch (err) {
    if (!/exercisedb_/.test(err.message)) throw err
    edbColumns = false
    rows = await selectAll('exercises', base, (q) => q.in('source', CATALOG_SOURCES))
  }
  const map = new Map(rows.map((r) => [r.external_id, r]))
  map.edbColumns = edbColumns
  return map
}

async function selectAll(table, columns, build) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await withRetry(() => build(supabase.from(table).select(columns)).range(from, from + 999), `select ${table}`)
    if (error) throw new Error(`select ${table}: ${error.message}`)
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

// PostgREST requires every object in a batch to have the same keys, so rows are grouped by key signature.
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

async function downloadBinary(url, gate) {
  const res = await fetchWithRetry(url, gate)
  return Buffer.from(await res.arrayBuffer())
}

async function fetchWithRetry(url, gate, headers = {}) {
  let lastErr
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    await gate()
    try {
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, ...headers }, signal: AbortSignal.timeout(60_000) })
      if (res.ok) return res
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
    const eq = a.indexOf('=')
    if (eq === -1) out[a.slice(2)] = true
    else out[a.slice(2, eq)] = a.slice(eq + 1)
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

function countBy(list) {
  const out = {}
  for (const x of list) out[x] = (out[x] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]))
}
function sameList(a, b) { return Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]) }
function rel(p) { return p.slice(root.length + 1).replace(/\\/g, '/') }
function* chunks(arr, size) { for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size) }
function fail(msg) { console.error(`error: ${msg}`); process.exit(1) }

function printSummary() {
  const dry = (v) => (DRY_RUN ? '(dry)' : v)
  const rows = [
    ['media', 'frames already in place', stats.framesKept],
    ['media', 'frames uploaded', stats.framesUploaded],
    ['media', 'frames failed', stats.framesFailed],
    ['db', 'exercise rows upserted', dry(stats.upserted)],
    ['db', 'stale rows (not selected)', dry(stats.stale)],
    ['exercisedb', 'list rows', SKIP_EDB ? '(skipped)' : stats.edbRows],
    ['exercisedb', 'exact', stats.edbExact],
    ['exercisedb', 'fuzzy', stats.edbFuzzy],
    ['exercisedb', 'ai', dry(stats.edbAi)],
    ['exercisedb', 'manual (untouched)', dry(stats.edbManual)],
    ['exercisedb', DRY_RUN ? 'unmatched before AI' : 'unmatched', stats.edbUnmatched],
    ['exercisedb', 'rows updated', dry(stats.edbUpdated)],
    ['gemini', 'requests (all steps)', stats.aiRequests],
    ['generate', 'rows with generated steps', stats.generated],
    ['generate', 'items rejected', stats.generateRejected],
    ['translate', 'rows translated', stats.translated],
    ['translate', 'items rejected', stats.translateRejected],
    ['exercisedb', 'AI answers rejected', stats.matchRejected],
  ]
  rows.push(['run', 'warnings', warnings.length], ['run', 'errors', errors.length], ['run', 'duration', `${((Date.now() - startedAt) / 1000).toFixed(1)}s`])
  const w1 = Math.max(...rows.map((r) => r[0].length)), w2 = Math.max(...rows.map((r) => r[1].length))
  const line = `+${'-'.repeat(w1 + 2)}+${'-'.repeat(w2 + 2)}+${'-'.repeat(14)}+`
  console.log(`\n${line}`)
  for (const [a, b, c] of rows) console.log(`| ${a.padEnd(w1)} | ${b.padEnd(w2)} | ${String(c).padStart(12)} |`)
  console.log(line)
  if (errors.length) console.log(`\n${errors.length} error(s): exit code 1`)
  else console.log(DRY_RUN ? '\nDry run complete: no database writes.' : '\nSync complete.')
}
