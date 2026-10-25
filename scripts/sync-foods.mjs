#!/usr/bin/env node
// Food catalog sync into public.food_catalog (values per 100 g).
//
// Sources
//   curated   scripts/food-catalog-tr.json: Turkish dishes and staples, approximate values
//   usda      USDA FoodData Central Foundation Foods + SR Legacy CSV downloads (public domain, CC0)
// Turkish names for USDA rows are machine-translated with Gemini (name_tr_machine = true) when
// GEMINI_API_KEY is set; untranslated rows stay searchable by their English name.
//
// Usage
//   node scripts/sync-foods.mjs                      curated + USDA + translate missing names
//   node scripts/sync-foods.mjs --only=curated       just the curated Turkish list
//   node scripts/sync-foods.mjs --only=usda
//   node scripts/sync-foods.mjs --if-empty           skip the USDA download when USDA rows exist
//   node scripts/sync-foods.mjs --translate-limit=2000   max names translated in this run (default 3000)
//   node scripts/sync-foods.mjs --dry-run            parse and report, write nothing
//
// Credentials (never committed): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (GitHub Secrets in CI, or
// ./.env.sync.local locally), optional GEMINI_API_KEY and GEMINI_MODEL.
// The service role is used only here, server-side; the app reads the catalog with the user's token.

import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { parseCsvLine, pickEnergy, isBrandedDescription, EXCLUDED_CATEGORIES } from './food-catalog-lib.mjs'

const FDC = 'https://fdc.nal.usda.gov/fdc-datasets/'
const DATASETS = [
  { file: 'FoodData_Central_foundation_food_csv_2026-04-30.zip', source: 'usda_foundation', dataType: 'foundation_food' },
  { file: 'FoodData_Central_sr_legacy_food_csv_2018-04.zip', source: 'usda_sr', dataType: 'sr_legacy_food' },
]
const NUTRIENTS = { energy: [1008, 2048, 2047], protein: [1003], fat: [1004, 1085], carb: [1005, 1050] }
const CHUNK = 500
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
const DRY = Boolean(args['dry-run'])
const ONLY = typeof args.only === 'string' ? args.only : null
const TRANSLATE_LIMIT = Number(args['translate-limit'] ?? 3000)

loadEnvFile(join(root, '.env.sync.local'))
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const GEMINI_KEY = process.env.GEMINI_API_KEY
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'
if (!DRY && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or use --dry-run).')
  process.exit(1)
}
const db = DRY ? null : createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

let failed = false
try {
  if (!ONLY || ONLY === 'curated') await syncCurated()
  if (!ONLY || ONLY === 'usda') await syncUsda()
  if (!DRY && GEMINI_KEY && ONLY !== 'curated') await translateMissing()
  else if (!GEMINI_KEY) console.log('GEMINI_API_KEY not set: USDA rows keep English names for now.')
} catch (e) {
  failed = true
  console.error(e)
}
process.exit(failed ? 1 : 0)

// ---------------------------------------------------------------------------------------------
async function syncCurated() {
  const { items } = JSON.parse(readFileSync(join(root, 'scripts/food-catalog-tr.json'), 'utf8'))
  const rows = items.map((it) => ({
    id: it.id,
    source: 'curated',
    name_en: it.en,
    name_tr: it.tr,
    name_tr_machine: false,
    category: it.category,
    kcal_100g: it.kcal,
    protein_100g: it.protein,
    carb_100g: it.carb,
    fat_100g: it.fat,
    portion_g: it.portion_g,
    portion_tr: it.portion_tr,
    portion_en: it.portion_en,
  }))
  console.log(`curated: ${rows.length} items`)
  await upsert(rows)
}

async function syncUsda() {
  if (args['if-empty'] && !DRY) {
    const { count, error } = await db.from('food_catalog').select('id', { count: 'exact', head: true }).neq('source', 'curated')
    if (error) throw error
    if ((count ?? 0) > 0) {
      console.log(`usda: ${count} rows already loaded, skipping download (--if-empty)`)
      return
    }
  }
  for (const ds of DATASETS) {
    const dir = await downloadAndExtract(ds.file)
    const rows = await parseDataset(dir, ds)
    console.log(`usda ${ds.source}: ${rows.length} foods`)
    // name_tr is not sent, so existing translations are kept on re-sync.
    await upsert(rows)
  }
}

async function downloadAndExtract(file) {
  const dir = mkdtempSync(join(tmpdir(), 'fdc-'))
  const zip = join(dir, file)
  const res = await fetch(FDC + file, { headers: { 'User-Agent': 'my-trainer food sync (+https://github.com/bhtyrbyr/my-trainer)' } })
  if (!res.ok) throw new Error(`download ${file}: HTTP ${res.status}`)
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()))
  try {
    execFileSync('unzip', ['-o', '-q', zip, '-d', dir])
  } catch {
    execFileSync('tar', ['-xf', zip, '-C', dir]) // Windows bsdtar reads zip
  }
  return dir
}

function findCsv(dir, name) {
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) stack.push(p)
      else if (f === name) return p
    }
  }
  throw new Error(`${name} not found in ${dir}`)
}

async function readCsv(path, onRow) {
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity })
  let header = null
  for await (const line of rl) {
    if (!line) continue
    const cells = parseCsvLine(line)
    if (!header) {
      header = cells
      continue
    }
    onRow(Object.fromEntries(header.map((h, i) => [h, cells[i]])))
  }
}

async function parseDataset(dir, ds) {
  const categories = new Map()
  await readCsv(findCsv(dir, 'food_category.csv'), (r) => categories.set(r.id, r.description))
  const foods = new Map()
  await readCsv(findCsv(dir, 'food.csv'), (r) => {
    if (r.data_type !== ds.dataType) return
    const category = categories.get(r.food_category_id) ?? null
    if (category && EXCLUDED_CATEGORIES.has(category)) return
    if (isBrandedDescription(r.description)) return
    foods.set(r.fdc_id, { description: r.description, category, n: {} })
  })
  const wanted = new Set(Object.values(NUTRIENTS).flat().map(String))
  await readCsv(findCsv(dir, 'food_nutrient.csv'), (r) => {
    const f = foods.get(r.fdc_id)
    if (f && wanted.has(r.nutrient_id) && r.amount !== '') f.n[r.nutrient_id] = Number(r.amount)
  })
  const portions = new Map()
  const portionCsv = (() => {
    try {
      return findCsv(dir, 'food_portion.csv')
    } catch {
      return null
    }
  })()
  if (portionCsv) {
    await readCsv(portionCsv, (r) => {
      if (!foods.has(r.fdc_id) || portions.has(r.fdc_id)) return
      const g = Number(r.gram_weight)
      if (!(g > 0 && g <= 2000)) return
      const label = [r.amount && r.amount !== '0' ? r.amount : '', r.modifier || r.portion_description].filter(Boolean).join(' ').trim()
      if (label) portions.set(r.fdc_id, { g, label: label.slice(0, 60) })
    })
  }
  const rows = []
  for (const [id, f] of foods) {
    const kcal = pickEnergy(f.n, NUTRIENTS.energy)
    if (kcal == null || kcal > 1000) continue
    const get = (ids) => {
      for (const i of ids) if (f.n[i] != null) return clamp(f.n[i], 100)
      return 0
    }
    const p = portions.get(id)
    rows.push({
      id: `usda:${id}`,
      source: ds.source,
      name_en: f.description.slice(0, 200),
      category: f.category,
      kcal_100g: Math.round(kcal * 10) / 10,
      protein_100g: get(NUTRIENTS.protein),
      carb_100g: get(NUTRIENTS.carb),
      fat_100g: get(NUTRIENTS.fat),
      portion_g: p?.g ?? null,
      portion_en: p?.label ?? null,
    })
  }
  return rows
}

const clamp = (n, max) => Math.round(Math.min(Math.max(n, 0), max) * 10) / 10

async function upsert(rows) {
  if (DRY) return
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from('food_catalog').upsert(rows.slice(i, i + CHUNK), { onConflict: 'id' })
    if (error) throw error
  }
}

// ---------------------------------------------------------------------------------------------
/** Lite requests left today (Pacific day) minus a reserve kept for users' food estimates. */
const USER_RESERVE = 100
async function liteBudget() {
  const { data: cfg } = await db.from('app_config').select('value').eq('key', 'ai_model_limits').maybeSingle()
  const rpd = Number(cfg?.value?.[GEMINI_MODEL]?.rpd ?? 500)
  const dayPt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  const { count } = await db.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('model', GEMINI_MODEL).eq('day_pt', dayPt)
  return rpd - (count ?? 0) - USER_RESERVE
}

async function translateMissing() {
  let done = 0
  while (done < TRANSLATE_LIMIT) {
    if ((await liteBudget()) <= 0) {
      console.log(`translation paused: keeping ${USER_RESERVE} ${GEMINI_MODEL} requests for users today; the next run continues`)
      break
    }
    const { data, error } = await db
      .from('food_catalog')
      .select('id, name_en, portion_en')
      .is('name_tr', null)
      .order('source')
      .order('id')
      .limit(80)
    if (error) throw error
    if (!data?.length) break
    const out = await geminiTranslate(data)
    const byId = new Map(out.map((o) => [o.id, o]))
    const updates = data
      .map((r) => {
        const t = byId.get(r.id)
        if (!t?.tr) return null
        return { id: r.id, name_tr: String(t.tr).slice(0, 200), portion_tr: t.portion ? String(t.portion).slice(0, 60) : null, name_tr_machine: true }
      })
      .filter(Boolean)
    for (const u of updates) {
      const { error: e } = await db.from('food_catalog').update({ name_tr: u.name_tr, portion_tr: u.portion_tr, name_tr_machine: true }).eq('id', u.id)
      if (e) throw e
    }
    done += data.length
    console.log(`translated ${updates.length}/${data.length} (total ${done})`)
    if (updates.length === 0) break
    await new Promise((r) => setTimeout(r, 4000)) // stay well under free-tier RPM
  }
}

async function geminiTranslate(rows) {
  const prompt = [
    'Translate these USDA food descriptions into short, natural Turkish food names, the way a Turkish person would search for them in a calorie app',
    '(e.g. "Cheese, feta" -> "Beyaz peynir (feta)", "Rice, white, long-grain, regular, cooked" -> "Pirinç, beyaz, pişmiş").',
    'Keep the cooking state (çiğ, haşlanmış, kızartılmış...) and the key variety. Also translate the portion label if present (e.g. "1 cup, chopped" -> "1 su bardağı, doğranmış").',
    'Return JSON only: [{"id": "...", "tr": "...", "portion": "..." | null}]. Items:',
    JSON.stringify(rows.map((r) => ({ id: r.id, en: r.name_en, portion: r.portion_en }))),
  ].join('\n')
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { id: { type: 'STRING' }, tr: { type: 'STRING' }, portion: { type: 'STRING', nullable: true } },
            required: ['id', 'tr'],
          },
        },
      },
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const u = data?.usageMetadata ?? {}
  // counts only, for the admin AI usage dashboard (system rows have no user)
  await db.from('ai_usage_log').insert({
    user_id: null,
    action: 'catalog_translate',
    provider: 'gemini',
    model: GEMINI_MODEL,
    prompt_tokens: u.promptTokenCount ?? 0,
    output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    total_tokens: u.totalTokenCount ?? 0,
    ok: true,
  })
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '[]'
  const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```$/, ''))
  return Array.isArray(parsed) ? parsed : []
}

function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
