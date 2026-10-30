#!/usr/bin/env node
// Exercise catalog v2 sync: openly licensed exercises from wger and workout-guide into
// public.exercises (+ SVG frames in the private `exercise-media` bucket, `exercise_catalog_meta`).
// Replaces scripts/sync-exercises.mjs for exercises; the muscles part (`sync-exercises.mjs --only=wger`)
// is unchanged. Contract: docs/catalog-v2-spec.md. Licences: docs/LICENSING.md.
//
// Sources (pinned)
//   wger          https://wger.de/api/v2/exerciseinfo/  text CC BY-SA 3/4 or CC0 per entry (license_author)
//   workout-guide https://github.com/bryllim/workout-guide  pinned to commit
//                 aac599224bb9780305239607ef98540b7e0ce389 (commit of 2026-08-26, pinned 2026-10-30):
//                 302 exercises x 3 SVG frames, CC BY-SA 4.0 (76 first frames traced from Everkinetic);
//                 manifest metadata MIT. Bump WG_SHA deliberately and re-run with --force-media.
//
// Usage
//   node scripts/sync-catalog.mjs --dry-run                fetch, select, map; writes scripts/out/catalog-plan.json
//                                                          and scripts/out/legacy-map.json; no DB writes, no
//                                                          credentials needed
//   node scripts/sync-catalog.mjs                          upsert rows, upload frames, meta, translate (default 30 req)
//   node scripts/sync-catalog.mjs --translate-limit=N      max Gemini Flash Lite requests this run (20 exercises
//                                                          each, default 30, 0 = no translation)
//   node scripts/sync-catalog.mjs --skip-media             rows only (keeps media_frames already set)
//   node scripts/sync-catalog.mjs --force-media            re-upload every frame (after a WG_SHA bump)
//   node scripts/sync-catalog.mjs --replace-legacy         ONLY after the product owner reviewed legacy-map.json:
//                                                          repoint/retire ExerciseDB rows via the two RPCs, then
//                                                          delete exercise-media/gifs/*. Add --dry-run to preview.
//
// Credentials (never committed; `*.local` is gitignored)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  GitHub Secrets in CI, or ./.env.sync.local locally
//   GEMINI_API_KEY                           optional; translation is skipped without it
//   GEMINI_LITE_MODEL                        optional, default gemini-3.5-flash-lite; must be a Flash Lite model
// The service role is used only here, server-side (CLAUDE.md rule 3); third-party APIs are called only
// from scripts/* (rule 4).
//
// Old ExerciseDB names for legacy-map.json come from, in order: the database (with credentials), the
// local cache scripts/out/exercisedb-cache.json, or one paced fetch of the ExerciseDB list (then cached).
//
// Behaviour
//   - Idempotent: rows upserted by external_id (`wger:<uuid>`, `wg:<slug>`); name_tr / instructions_tr are
//     never overwritten (curated names from scripts/exercise-names-tr.json fill name_tr where null, before
//     machine translation, so they win).
//   - media_frames is only set once every frame of the row is in the bucket; an earlier value is never nulled.
//   - Translation keeps the user reserve: liteBudget() = Flash Lite RPD (app_config.ai_model_limits) minus
//     today's (Pacific day) ai_usage_log rows minus 100; every request is logged with action
//     'catalog_translate' (429s are not logged, as Google does not count them).
//   - Exit code 1 if any hard failure happened (the run still completes so progress is kept).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  TRANSLATE_BATCH,
  TRANSLATE_SCHEMA,
  buildCatalog,
  buildLegacyMap,
  buildTranslatePrompt,
  checkCoreLifts,
  isFlashLite,
  isSafeSvg,
  mergeAttribution,
  pacificDay,
  validateTranslations,
  withMachineTranslation,
} from './catalog-lib.mjs'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WG_SHA = 'aac599224bb9780305239607ef98540b7e0ce389'
const WG_MANIFEST = `https://raw.githubusercontent.com/bryllim/workout-guide/${WG_SHA}/packages/workout-guide/manifest.json`
const WGER = 'https://wger.de/api/v2'
const BUCKET = 'exercise-media'
const RETRIES = 3
const BACKOFF_BASE_MS = 1000
const API_MIN_INTERVAL_MS = 1100
const MEDIA_MIN_INTERVAL_MS = 150
const GEMINI_MIN_INTERVAL_MS = 4500 // Flash Lite free tier: 15 RPM
const USER_RESERVE = 100
const DB_CHUNK = 200
const MAX_MEDIA_BYTES = 5 * 1024 * 1024
const META = {
  'wger-exercises': 'Exercise text: wger contributors (https://wger.de), CC BY-SA 3.0/4.0 or CC0 per exercise; illustrations from wger only where Everkinetic, AI-generated or Wikimedia.',
  'workout-guide': `Exercise illustrations: workout-guide by Bryl Lim (${WG_SHA.slice(0, 7)}), CC BY-SA 4.0, partly adapted from Everkinetic (CC BY-SA 4.0); metadata MIT. https://github.com/bryllim/workout-guide`,
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const OUT = resolve(root, 'scripts/out')
const PLAN_FILE = resolve(OUT, 'catalog-plan.json')
const LEGACY_FILE = resolve(OUT, 'legacy-map.json')

// ---------------------------------------------------------------------------
// CLI + env
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 48).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(0)
}
const DRY_RUN = Boolean(args['dry-run'])
const REPLACE_LEGACY = Boolean(args['replace-legacy'])
const SKIP_MEDIA = Boolean(args['skip-media'])
const FORCE_MEDIA = Boolean(args['force-media'])
const CONCURRENCY = Math.max(1, Number(args.concurrency ?? 4) || 4)
const TRANSLATE_LIMIT = Math.max(0, Math.floor(Number(args['translate-limit'] ?? 30)))
if (!Number.isFinite(TRANSLATE_LIMIT)) fail('--translate-limit must be a number')

loadEnvFile(resolve(root, '.env.sync.local'))
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const GEMINI_KEY = process.env.GEMINI_API_KEY
const GEMINI_MODEL = process.env.GEMINI_LITE_MODEL || 'gemini-3.5-flash-lite'
const HAS_CREDS = Boolean(SUPABASE_URL && SERVICE_KEY)
if ((!DRY_RUN || REPLACE_LEGACY) && !HAS_CREDS) {
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
  curatedApplied: 0,
  translateRequests: 0,
  translated: 0,
  translateRejected: 0,
  legacyReplaced: 0,
  legacyRetired: 0,
  legacyDeleted: 0,
  gifsDeleted: 0,
}
const warnings = []
const errors = []
const log = (msg) => console.log(msg)
const warn = (msg) => { warnings.push(msg); console.warn(`  ! ${msg}`) }
const hardError = (msg) => { errors.push(msg); console.error(`  x ${msg}`) }

const apiGate = makeGate(API_MIN_INTERVAL_MS)
const mediaGate = makeGate(MEDIA_MIN_INTERVAL_MS)
const geminiGate = makeGate(GEMINI_MIN_INTERVAL_MS)

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

try {
  log(`sync-catalog  mode=${DRY_RUN ? 'DRY RUN' : 'write'}${REPLACE_LEGACY ? ' replace-legacy' : ''}  credentials=${HAS_CREDS ? 'yes' : 'no'}  workout-guide@${WG_SHA.slice(0, 7)}`)
  if (REPLACE_LEGACY) await replaceLegacy()
  else await sync()
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

  // 3. Legacy map + curated Turkish names
  const legacy = await loadLegacyRows()
  const legacyMap = buildLegacyMap(legacy.rows, rows)
  const curated = curatedNames()
  writeOutputs({ catalog, core, legacy, legacyMap, curated, licenses })

  if (DRY_RUN) return

  // 4. Existing rows (media + attribution notes survive re-syncs)
  const existing = await fetchExisting()
  const selectedIds = new Set(rows.map((r) => r.external_id))
  stats.stale = [...existing.keys()].filter((id) => !selectedIds.has(id)).length
  if (stats.stale) warn(`${stats.stale} catalog row(s) from wger/workout-guide are no longer selected; left untouched`)

  // 5. Media
  const mediaFor = await syncMedia(rows, existing)

  // 6. Rows
  const out = rows.map((r) => {
    const row = {
      external_id: r.external_id,
      source: r.source,
      is_custom: false,
      name_en: r.name_en,
      body_parts: r.body_parts,
      target_muscles: r.target_muscles,
      secondary_muscles: r.secondary_muscles,
      equipment: r.equipment,
      instructions_en: r.instructions_en,
      attribution: mergeAttribution(r.attribution, existing.get(r.external_id)?.attribution),
    }
    if (mediaFor.has(r.external_id)) row.media_frames = mediaFor.get(r.external_id)
    return row
  })
  stats.upserted = await upsertRows('exercises', out, 'external_id')
  log(`[db] upserted ${stats.upserted} exercise row(s)`)

  // 7. Curated Turkish names where name_tr is still null
  for (const [externalId, tr] of curated) {
    if (existing.get(externalId)?.name_tr != null) continue
    const { data, error } = await withRetry(() => supabase.from('exercises').update({ name_tr: tr }).eq('external_id', externalId).is('name_tr', null).select('id'), `name_tr ${externalId}`)
    if (error) { hardError(`curated name_tr ${externalId}: ${error.message}`); continue }
    stats.curatedApplied += data?.length ?? 0
  }
  log(`[db] curated Turkish names applied: ${stats.curatedApplied}`)

  // 8. Meta
  const counts = { 'wger-exercises': rows.filter((r) => r.source === 'wger').length, 'workout-guide': rows.filter((r) => r.source === 'workout-guide').length }
  for (const [source, count] of Object.entries(counts)) {
    const { error } = await withRetry(() => supabase.from('exercise_catalog_meta').upsert({ source, item_count: count, synced_at: new Date().toISOString(), license_text: META[source] }, { onConflict: 'source' }), `meta ${source}`)
    if (error) hardError(`exercise_catalog_meta ${source}: ${error.message}`)
  }

  // 9. Turkish machine translation
  await translateMissing(legacyMap, legacy.rows)
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

/** Old ExerciseDB rows still in the database (only until the one-time removal has run). Never fetched from ExerciseDB. */
async function loadLegacyRows() {
  if (supabase) {
    const rows = await selectAll('exercises', 'external_id,name_en,equipment', (q) => q.eq('source', 'exercisedb'))
    log(`[legacy] ${rows.length} ExerciseDB row(s) left in the database`)
    return { origin: 'database', rows }
  }
  log('[legacy] no database access: legacy map skipped')
  return { origin: 'none', rows: [] }
}

/** scripts/exercise-names-tr.json: curated Turkish names keyed by catalog external_id. */
function curatedNames() {
  const file = resolve(root, 'scripts/exercise-names-tr.json')
  const out = new Map()
  if (!existsSync(file)) return out
  const json = JSON.parse(readFileSync(file, 'utf8'))
  for (const [externalId, name] of Object.entries(json.names ?? {})) {
    const tr = typeof name === 'string' ? name.trim() : ''
    if (tr) out.set(externalId, tr.slice(0, 120))
  }
  return out
}

function writeOutputs({ catalog, core, legacy, legacyMap, curated, licenses }) {
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
    stats: { ...catalog.stats, bySource: countBy(rows.map((r) => r.source)), byBodyPart, byEquipment, curatedNamesTr: curated.size },
    core_lifts: core,
    no_equipment_term: rows.filter((r) => !r.equipment.length).map((r) => r.name_en),
    dropped: catalog.dropped,
    workout_guide_matched_to_wger: catalog.wgMatched,
    exercises: rows.map(({ _frames, _origin, ...r }) => ({
      ...r,
      name_tr_curated: curated.get(r.external_id) ?? null,
      media_frames: _frames.map((f) => f.storage),
      media_sources: _frames.map((f) => f.url),
      origin: _origin,
    })),
  }
  writeFileSync(PLAN_FILE, `${JSON.stringify(plan, null, 2)}\n`)
  const matched = legacyMap.filter((e) => e.new).length
  writeFileSync(
    LEGACY_FILE,
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        note: 'old ExerciseDB external_id -> new external_id (null = retire: kept as source=legacy when referenced, else deleted). Review before running --replace-legacy.',
        old_rows_from: legacy.origin,
        stats: { total: legacyMap.length, matched, unmatched: legacyMap.length - matched, distinct_targets: new Set(legacyMap.filter((e) => e.new).map((e) => e.new)).size },
        entries: legacyMap,
      },
      null,
      2,
    )}\n`,
  )
  log(`[out] ${rel(PLAN_FILE)} (${rows.length} exercises), ${rel(LEGACY_FILE)} (${matched}/${legacyMap.length} matched)`)
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
// Translation (Gemini Flash Lite)
// ---------------------------------------------------------------------------

async function liteBudget() {
  const { data: cfg, error: e1 } = await supabase.from('app_config').select('value').eq('key', 'ai_model_limits').maybeSingle()
  if (e1) throw new Error(`app_config: ${e1.message}`)
  const rpd = Number(cfg?.value?.[GEMINI_MODEL]?.rpd ?? 500)
  const { count, error: e2 } = await supabase.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('model', GEMINI_MODEL).eq('day_pt', pacificDay())
  if (e2) throw new Error(`ai_usage_log: ${e2.message}`)
  return rpd - (count ?? 0) - USER_RESERVE
}

async function translateMissing(legacyMap, legacyRows) {
  if (TRANSLATE_LIMIT === 0) { log('[translate] disabled (--translate-limit=0)'); return }
  if (!GEMINI_KEY) { log('[translate] GEMINI_API_KEY not set: Turkish fields stay empty for now'); return }
  if (!isFlashLite(GEMINI_MODEL)) { hardError(`[translate] ${GEMINI_MODEL} is not a Flash Lite model; refusing to translate`); return }

  const rows = await selectAll('exercises', 'external_id,name_en,name_tr,instructions_en,instructions_tr,attribution', (q) => q.in('source', ['wger', 'workout-guide']).or('name_tr.is.null,instructions_tr.is.null').order('external_id'))
  const todo = rows.filter((r) => r.name_tr == null || (r.instructions_tr == null && (r.instructions_en ?? []).length))
  log(`[translate] ${todo.length} row(s) need Turkish; up to ${TRANSLATE_LIMIT} request(s) of ${TRANSLATE_BATCH}`)
  if (!todo.length) return

  // House style from the curated list: old English name -> curated Turkish name.
  const oldName = new Map(legacyRows.map((r) => [r.external_id, r.name_en]))
  const file = resolve(root, 'scripts/exercise-names-tr.json')
  const names = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).names ?? {}) : {}
  const examples = legacyMap.filter((e) => e.new && names[e.old]).slice(0, 12).map((e) => [oldName.get(e.old) ?? e.old_name, names[e.old]])

  let failures = 0
  for (let i = 0; i < todo.length && stats.translateRequests < TRANSLATE_LIMIT; i += TRANSLATE_BATCH) {
    const budget = await liteBudget()
    if (budget <= 0) { log(`[translate] paused: keeping ${USER_RESERVE} ${GEMINI_MODEL} requests for users today; the next run continues`); break }
    const batch = todo.slice(i, i + TRANSLATE_BATCH)
    const items = batch.map((r) => ({ id: r.external_id, name_en: r.name_en, instructions_en: r.instructions_en ?? [] }))
    let output
    try {
      output = await geminiTranslate(items, examples)
    } catch (err) {
      if (err.status === 429) { warn(`[translate] Gemini quota reached (429); stopping for this run`); break }
      failures++
      hardError(`[translate] request failed: ${err.message}`)
      if (failures >= 3) break
      continue
    }
    const { accepted, rejected } = validateTranslations(items, output)
    stats.translateRejected += rejected.length
    for (const r of rejected) warn(`[translate] ${r.id}: ${r.reason}`)
    const byId = new Map(batch.map((r) => [r.external_id, r]))
    for (const t of accepted) {
      const row = byId.get(t.id)
      const patch = {}
      if (row.name_tr == null) patch.name_tr = t.name_tr
      if (row.instructions_tr == null && (row.instructions_en ?? []).length) patch.instructions_tr = t.instructions_tr
      if (!Object.keys(patch).length) continue
      patch.attribution = withMachineTranslation(row.attribution)
      const { data, error } = await withRetry(() => {
        let q = supabase.from('exercises').update(patch).eq('external_id', t.id)
        if ('name_tr' in patch) q = q.is('name_tr', null)
        if ('instructions_tr' in patch) q = q.is('instructions_tr', null)
        return q.select('id')
      }, `translate ${t.id}`)
      if (error) { hardError(`[translate] update ${t.id}: ${error.message}`); continue }
      stats.translated += data?.length ?? 0
    }
    log(`[translate] request ${stats.translateRequests}: ${accepted.length}/${items.length} accepted (total ${stats.translated})`)
  }
}

async function geminiTranslate(items, examples) {
  await geminiGate()
  stats.translateRequests++
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildTranslatePrompt(items, examples) }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: TRANSLATE_SCHEMA },
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
    action: 'catalog_translate',
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
// --replace-legacy
// ---------------------------------------------------------------------------

async function replaceLegacy() {
  if (!existsSync(LEGACY_FILE)) throw new Error(`${rel(LEGACY_FILE)} not found: run --dry-run first and have it reviewed`)
  const map = JSON.parse(readFileSync(LEGACY_FILE, 'utf8'))
  const entries = Array.isArray(map.entries) ? map.entries : []
  log(`[legacy] ${entries.length} reviewed entr(ies) from ${rel(LEGACY_FILE)} (generated ${map.generated_at})`)

  const oldRows = await selectAll('exercises', 'id,external_id', (q) => q.eq('source', 'exercisedb'))
  const newRows = await selectAll('exercises', 'id,external_id', (q) => q.in('source', ['wger', 'workout-guide']))
  const oldByExt = new Map(oldRows.map((r) => [r.external_id, r.id]))
  const newByExt = new Map(newRows.map((r) => [r.external_id, r.id]))
  const inMap = new Set(entries.map((e) => e.old))
  const notInMap = oldRows.filter((r) => !inMap.has(r.external_id))
  if (notInMap.length) warn(`${notInMap.length} ExerciseDB row(s) are not in legacy-map.json and stay untouched (${notInMap.slice(0, 5).map((r) => r.external_id).join(', ')}...)`)
  const missingTargets = entries.filter((e) => e.new && !newByExt.has(e.new))
  if (missingTargets.length) throw new Error(`${missingTargets.length} target row(s) are not in the database yet (e.g. ${missingTargets[0].new}); run the normal sync first`)

  const todo = entries.filter((e) => oldByExt.has(e.old))
  log(`[legacy] ${todo.length} to process (${todo.filter((e) => e.new).length} replace, ${todo.filter((e) => !e.new).length} retire); ${entries.length - todo.length} already done`)
  if (DRY_RUN) { log('[legacy] dry run: no RPCs called, no GIFs deleted'); return }

  for (const e of todo) {
    const oldId = oldByExt.get(e.old)
    if (e.new) {
      const { error } = await withRetry(() => supabase.rpc('replace_catalog_exercise', { p_old: oldId, p_new: newByExt.get(e.new) }), `replace ${e.old}`)
      if (error) { hardError(`replace ${e.old} -> ${e.new}: ${error.message}`); continue }
      stats.legacyReplaced++
    } else {
      const { data, error } = await withRetry(() => supabase.rpc('retire_catalog_exercise', { p_id: oldId }), `retire ${e.old}`)
      if (error) { hardError(`retire ${e.old}: ${error.message}`); continue }
      if (data === 'deleted') stats.legacyDeleted++
      else stats.legacyRetired++
    }
  }
  log(`[legacy] replaced ${stats.legacyReplaced}, retired ${stats.legacyRetired}, deleted ${stats.legacyDeleted}`)

  // GIFs go only when every ExerciseDB row is gone (replaced, retired with gif_path cleared, or deleted).
  const { count, error } = await supabase.from('exercises').select('id', { count: 'exact', head: true }).eq('source', 'exercisedb')
  if (error) throw new Error(`count exercisedb rows: ${error.message}`)
  if (errors.length || (count ?? 0) > 0) { warn(`GIFs kept: ${count ?? '?'} ExerciseDB row(s) remain or errors occurred`); return }
  for (;;) {
    const { data, error: e } = await withRetry(() => supabase.storage.from(BUCKET).list('gifs', { limit: 100, offset: 0 }), 'list gifs')
    if (e) throw new Error(`list gifs: ${e.message}`)
    const paths = (data ?? []).filter((o) => o.id).map((o) => `gifs/${o.name}`)
    if (!paths.length) break
    const { error: re } = await withRetry(() => supabase.storage.from(BUCKET).remove(paths), 'remove gifs')
    if (re) throw new Error(`remove gifs: ${re.message}`)
    stats.gifsDeleted += paths.length
  }
  log(`[legacy] deleted ${stats.gifsDeleted} GIF(s) from ${BUCKET}/gifs`)
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function fetchExisting() {
  const rows = await selectAll('exercises', 'external_id,media_frames,attribution,name_tr,instructions_tr', (q) => q.in('source', ['wger', 'workout-guide']))
  return new Map(rows.map((r) => [r.external_id, r]))
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
      const res = await fetch(url, { headers: { 'user-agent': 'my-trainer-sync (github.com/bhtyrbyr/my-trainer)', ...headers }, signal: AbortSignal.timeout(60_000) })
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
  const rows = REPLACE_LEGACY
    ? [
        ['legacy', 'replaced', stats.legacyReplaced],
        ['legacy', 'retired (kept as legacy)', stats.legacyRetired],
        ['legacy', 'deleted (unreferenced)', stats.legacyDeleted],
        ['legacy', 'GIFs deleted', stats.gifsDeleted],
      ]
    : [
        ['media', 'frames already in place', stats.framesKept],
        ['media', 'frames uploaded', stats.framesUploaded],
        ['media', 'frames failed', stats.framesFailed],
        ['db', 'exercise rows upserted', DRY_RUN ? '(dry)' : stats.upserted],
        ['db', 'stale rows (not selected)', DRY_RUN ? '(dry)' : stats.stale],
        ['db', 'curated name_tr applied', DRY_RUN ? '(dry)' : stats.curatedApplied],
        ['translate', 'Gemini requests', stats.translateRequests],
        ['translate', 'rows translated', stats.translated],
        ['translate', 'items rejected', stats.translateRejected],
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
