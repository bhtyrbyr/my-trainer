// Pure helpers for scripts/sync-catalog.mjs (unit-tested in src/lib/catalogLib.test.ts).
// No I/O here: selection, vocabulary mapping, attribution and translation validation.
// Contract: docs/catalog-v2-spec.md ("Sources", "Selection", "Sync script").

// ---------------------------------------------------------------------------------------------
// Vocabulary (the app's existing terms; see src/locales/*/exercises.json and
// scripts/muscle-aliases.json). Every value emitted below must be one of these.

export const BODY_PARTS = ['back', 'cardio', 'chest', 'lower arms', 'lower legs', 'neck', 'shoulders', 'upper arms', 'upper legs', 'waist']

/** wger muscle id -> app muscle term (inverse of scripts/muscle-aliases.json, canonical term per id). */
export const WGER_MUSCLE = {
  1: 'biceps',
  2: 'deltoids',
  3: 'serratus anterior',
  4: 'pectorals',
  5: 'triceps',
  6: 'abdominals',
  7: 'calves',
  8: 'glutes',
  9: 'trapezius',
  10: 'quadriceps',
  11: 'hamstrings',
  12: 'latissimus dorsi',
  13: 'brachialis',
  14: 'obliques',
  15: 'soleus',
}

/** wger category name -> body part. */
export const WGER_CATEGORY = {
  Abs: 'waist',
  Arms: 'upper arms',
  Back: 'back',
  Calves: 'lower legs',
  Cardio: 'cardio',
  Chest: 'chest',
  Legs: 'upper legs',
  Shoulders: 'shoulders',
}

/** wger equipment name -> app equipment term; null = not an equipment filter value (bench, mat). */
export const WGER_EQUIPMENT = {
  Barbell: 'barbell',
  Bench: null,
  'Cable machine': 'cable',
  Dumbbell: 'dumbbell',
  'Gym mat': null,
  'Incline bench': null,
  Kettlebell: 'kettlebell',
  'none (bodyweight exercise)': 'bodyweight',
  'Pull-up bar': 'bodyweight',
  'Resistance band': 'resistance band',
  'Swiss Ball': 'stability ball',
  'SZ-Bar': 'EZ bar',
}

/** workout-guide equipment -> app equipment term; null = decide from the name. */
export const WG_EQUIPMENT = {
  Barbell: 'barbell',
  Bench: 'bodyweight',
  Bodyweight: 'bodyweight',
  Box: 'bodyweight',
  Cable: 'cable',
  Cardio: null,
  Chair: 'bodyweight',
  Doorway: 'bodyweight',
  Dumbbell: 'dumbbell',
  Kettlebell: 'kettlebell',
  Machine: 'leverage machine',
  Plate: 'weighted',
  'Pull-up Bar': 'bodyweight',
  'Resistance Band': 'resistance band',
  'Stability Ball': 'stability ball',
  Towel: 'towel',
  Wall: 'bodyweight',
}

/** workout-guide muscle -> app muscle terms. */
export const WG_MUSCLE = {
  Adductors: ['adductors'],
  Back: ['back'],
  Biceps: ['biceps'],
  Calves: ['calves'],
  Cardio: ['cardiovascular system'],
  Chest: ['pectorals'],
  Core: ['abdominals'],
  Forearms: ['forearms'],
  Glutes: ['glutes'],
  Grip: ['grip muscles'],
  Groin: ['adductors'],
  Hamstrings: ['hamstrings'],
  Hips: ['hip flexors'],
  Lats: ['latissimus dorsi'],
  Legs: ['quadriceps'],
  'Lower Back': ['erector spinae'],
  Mobility: [],
  'Posterior Chain': ['hamstrings', 'glutes', 'erector spinae'],
  Quads: ['quadriceps'],
  'Rear Delts': ['rear deltoids'],
  Shoulders: ['deltoids'],
  Triceps: ['triceps'],
  'Upper Back': ['upper back'],
}

/** workout-guide primary muscle -> body part (null = decide from equipment/name). */
export const WG_BODY_PART = {
  Adductors: 'upper legs',
  Back: 'back',
  Biceps: 'upper arms',
  Calves: 'lower legs',
  Chest: 'chest',
  Core: 'waist',
  Forearms: 'lower arms',
  Glutes: 'upper legs',
  Hamstrings: 'upper legs',
  Hips: 'upper legs',
  Lats: 'back',
  Legs: 'upper legs',
  'Lower Back': 'back',
  Mobility: null,
  'Posterior Chain': 'back',
  Quads: 'upper legs',
  'Rear Delts': 'shoulders',
  Shoulders: 'shoulders',
  Triceps: 'upper arms',
  'Upper Back': 'back',
}

// ---------------------------------------------------------------------------------------------
// Licences and media allow-list

export const WG_REPO = 'https://github.com/bryllim/workout-guide'
export const MACHINE_TRANSLATION = 'translated to Turkish (machine)'

/** wger short licence names -> SPDX-like display names. */
export function licenseName(short) {
  const s = String(short ?? '').trim()
  const m = s.match(/^CC-BY(-SA)? (\d)$/i)
  if (m) return `CC BY${m[1] ? '-SA' : ''} ${m[2]}.0`
  if (/^CC0/i.test(s)) return 'CC0 1.0'
  return s || 'unknown'
}

const RED_FLAG = /men'?s ?health|fitnessvolt|workout ?guru|liftmanual|lyfta|training\.fit|docteur-fitness|gymnasticbodies|athlean/i

/**
 * wger image licence class. Only 'everkinetic', 'ai' and 'wikimedia' may be used; red-flag sources are
 * checked first and win. Returns null for anything else (user uploads of unknown provenance).
 */
export function classifyWgerImage(img) {
  const src = [img.license_author, img.license_author_url, img.license_object_url, img.license_derivative_source_url, img.license_title, ...(img.author_history ?? [])]
    .filter(Boolean)
    .join(' ')
  if (RED_FLAG.test(src)) return 'red'
  if (/everkinetic/i.test(src)) return 'everkinetic'
  if (img.is_ai_generated === true) return 'ai'
  if (/wikimedia\.org|wikipedia\.org/i.test(src)) return 'wikimedia'
  return null
}

/** Storage-safe image types for the exercise-media bucket (image/gif, svg, png, webp only). */
export function imageType(url) {
  const ext = String(url).toLowerCase().match(/\.([a-z0-9]+)(?:$|\?)/)?.[1]
  if (ext === 'png') return { ext: 'png', contentType: 'image/png' }
  if (ext === 'webp') return { ext: 'webp', contentType: 'image/webp' }
  if (ext === 'svg') return { ext: 'svg', contentType: 'image/svg+xml' }
  return null
}

/** Rejects SVGs that could run code when opened directly from a signed URL. */
export function isSafeSvg(text) {
  const s = String(text)
  if (!/<svg[\s>]/i.test(s.slice(0, 4096))) return false
  return !/<script|<foreignObject|\son[a-z]+\s*=|javascript:|<iframe|<embed|<object|xlink:href\s*=\s*["']\s*(?!#)|href\s*=\s*["']\s*(?:https?:|data:)/i.test(s)
}

// ---------------------------------------------------------------------------------------------
// Text helpers

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', deg: '°', times: '×' }

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
}

export function stripHtml(html) {
  return decodeEntities(String(html ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

const MAX_STEPS = 12
const MAX_STEP_LEN = 500

function cleanStep(s) {
  return stripHtml(s)
    .replace(/^(?:step\s*)?\d{1,2}\s*[.):-]\s*/i, '')
    .replace(/^[-*•]\s*/, '')
    .trim()
}

function capStep(s) {
  if (s.length <= MAX_STEP_LEN) return s
  const cut = s.slice(0, MAX_STEP_LEN)
  const dot = cut.lastIndexOf('. ')
  return dot > 200 ? cut.slice(0, dot + 1) : `${cut.slice(0, MAX_STEP_LEN - 1).trimEnd()}…`
}

/** wger HTML description -> instruction steps (list items, else paragraphs, else sentences/lines). */
export function descriptionToSteps(html, source) {
  const h = String(html ?? '')
  let parts = []
  const li = [...h.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1])
  if (li.length) parts = li
  else {
    const p = [...h.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => m[1])
    if (p.length > 1) parts = p
    else {
      const raw = String(source ?? '').trim() || stripHtml(h)
      const lines = raw.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean)
      parts = lines.length > 1 ? lines : [stripHtml(p[0] ?? raw)]
    }
  }
  const steps = parts.map(cleanStep).filter((s) => s.length > 1).map(capStep)
  return steps.slice(0, MAX_STEPS)
}

/** Strips wger author tags and stray punctuation from a display name. */
export function cleanName(name) {
  let n = decodeEntities(String(name ?? ''))
    .replace(/[’‘`]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  n = n
    .replace(/\s+-\s+(?:NB|Mark Lauren)$/i, '')
    .replace(/\s+(?:HD|OL)$/, '')
    .replace(/[:;,.]+$/, '')
    .trim()
  return n.charAt(0).toLocaleUpperCase('en') + n.slice(1)
}

// Words that only appear in non-English names (wger "English" entries that were never translated).
const NON_ENGLISH = new Set([
  'mit', 'und', 'beinhebemaschine', 'knieheben', 'seitlich', 'bizeps', 'hantel', 'langhantel', 'kurzhantel', 'liegestütze', 'klimmzug', 'kniebeuge',
  'alle', 'parallele', 'isometria', 'lento', 'avanti', 'seduto', 'panca', 'jalón', 'jalon', 'agarre', 'ancho', 'estrecho', 'remo', 'maquina', 'máquina',
  'polea', 'alta', 'alto', 'supino', 'inclinado', 'patadas', 'traseras', 'pecho', 'sentadilla', 'talons', 'fesses', 'pompes', 'développé', 'tirage',
  'flexões', 'agachamento', 'rosca', 'supinado',
])

export function isEnglishName(name) {
  const n = String(name ?? '')
  if (/[^\u0000-ɏ’‘–—]/.test(n)) return false // non-Latin script
  if (/[ñáéíóúãõçàèìòùâêîôûäöüß]/i.test(n)) return false // accented letters do not occur in English exercise names
  return !n
    .toLowerCase()
    .split(/[^a-zà-ÿ]+/)
    .some((w) => NON_ENGLISH.has(w))
}

const JUNK = [
  /\btest\b/i,
  /^\d{3,}\b/, // catalog numbers ("3008 Abdominal Crunch")
  /\b\d+$/, // numbered copies ("Bear Walk 2")
  /^(biceps?|triceps?|upper back|lower back|chest|legs?|abs|shoulders?|back)$/i, // a muscle, not an exercise
  /^blaze$/i, // a branded class, not an exercise
  /\btrifecta\b/i,
  /\bss\b/i, // supersets bundled into one entry
]

export function isJunkName(name) {
  return JUNK.some((re) => re.test(String(name ?? '').trim()))
}

// ---------------------------------------------------------------------------------------------
// Name normalisation for de-duplication and matching

const PHRASES = [
  [/\bpush[\s-]*ups?\b|\bpress[\s-]*ups?\b|\bpushups?\b/g, ' pushup '],
  [/\bpull[\s-]*ups?\b|\bpullups?\b/g, ' pullup '],
  [/\bchin[\s-]*ups?\b|\bchinups?\b/g, ' chinup '],
  [/\bsit[\s-]*ups?\b|\bsitups?\b/g, ' situp '],
  [/\bstep[\s-]*ups?\b|\bstepups?\b/g, ' stepup '],
  [/\bpull[\s-]*downs?\b|\bpulldowns?\b/g, ' pulldown '],
  [/\bpush[\s-]*downs?\b|\bpushdowns?\b/g, ' pushdown '],
  [/\bskull[\s-]*crush(?:er|ers|es)?\b|\bskullcrushers?\b/g, ' skullcrusher '],
  [/\bt[\s-]*bar\b/g, ' tbar '],
  [/\b(?:ez|sz)[\s-]*bar\b/g, ' ezbar '],
  [/\btrap[\s-]*bar\b|\bhex[\s-]*bar\b/g, ' trapbar '],
  [/\bbench[\s-]*press(?:es)?\b|\bbenchpress\b/g, ' bench press '],
  [/\bdumbell\b/g, ' dumbbell '],
  [/\bhammercurls?\b/g, ' hammer curl '],
  [/\bcross[\s-]*overs?\b/g, ' crossover '],
  [/\bwood[\s-]*chop(?:per)?s?\b/g, ' woodchop '],
  [/\bdead[\s-]*bugs?\b/g, ' deadbug '],
  [/\bdead[\s-]*lifts?\b/g, ' deadlift '],
  [/\bdragon[\s-]*flags?\b/g, ' dragonflag '],
  [/\bjumping jacks?\b/g, ' jumpingjack '],
  [/\bface[\s-]*pulls?\b|\bfacepulls?\b/g, ' facepull '],
  [/\bab[\s-]*wheel\b/g, ' abwheel '],
  [/\bcat[\s-]*cow\b|\bcow[\s-]*cat\b/g, ' catcow '],
  [/\bhyper[\s-]*extensions?\b/g, ' hyperextension '],
  [/\bfarmers?'?s? (?:carry|walk)\b/g, ' farmercarry '],
  [/\brdls?\b/g, ' romanian deadlift '],
  [/\bohp\b/g, ' overhead press '],
  [/\bdb\b/g, ' dumbbell '],
  [/\bbb\b/g, ' barbell '],
  [/\bkb\b/g, ' kettlebell '],
]

const SINGULAR = { flies: 'fly', flyes: 'fly', flye: 'fly', calves: 'calf', rows: 'row', rowing: 'row', biceps: 'bicep', triceps: 'tricep', presses: 'press', crunches: 'crunch', lunges: 'lunge', raises: 'raise', squats: 'squat', curls: 'curl', dips: 'dip', shrugs: 'shrug', extensions: 'extension', kickbacks: 'kickback', bridges: 'bridge', swings: 'swing', thrusts: 'thrust', cleans: 'clean', snatches: 'snatch', kicks: 'kick', jumps: 'jump', walks: 'walk', planks: 'plank', twists: 'twist', dumbbells: 'dumbbell', barbells: 'barbell', kettlebells: 'kettlebell', cables: 'cable', bands: 'band', machines: 'machine', legs: 'leg', arms: 'arm', glutes: 'glute', hips: 'hip', knees: 'knee', toes: 'toe', hands: 'hand', delts: 'delt', lats: 'lat', abs: 'ab', plates: 'plate', reps: 'rep', alternating: 'alternate', running: 'run', jogging: 'jog' }
const STOP = new Set(['with', 'the', 'a', 'an', 'on', 'of', 'and', 'using', 'in', 'for', 'to', 'from', 'or', 'exercise', 'version'])
const SIDE = new Set(['left', 'right'])

/** Lower-case tokens with spelling variants folded together ("Push-Ups" -> ["pushup"]). */
export function nameTokens(name) {
  let s = ` ${decodeEntities(String(name ?? '')).toLowerCase().replace(/[’‘`]/g, "'").replace(/\bw\//g, ' with ')} `
  // "(male)", "v. 2", "ii" and repeated abbreviations like "(RDL)" carry no meaning.
  s = s.replace(/\((?:male|female|rdl|ohp|db|bb|kb)\)/g, ' ').replace(/\bv\.?\s*\d+\b/g, ' ').replace(/\b(?:ii|iii)\b/g, ' ')
  for (const [re, rep] of PHRASES) s = s.replace(re, rep)
  return s
    .replace(/'s\b/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => SINGULAR[t] ?? t)
    .filter((t) => !STOP.has(t))
}

/** Order-insensitive key without side words: "Calf raises, right leg" == "Calf Raise". */
export function nameKey(name) {
  // A multiset, not a set: "Side to Side Push Ups" must not equal "Side Push-Up".
  return nameTokens(stripSide(name)).filter((t) => !SIDE.has(t)).sort().join(' ')
}

// Name words that only restate the equipment; removed before comparing names across sources.
const EQUIPMENT_WORDS = new Set(['barbell', 'dumbbell', 'cable', 'machine', 'lever', 'leverage', 'kettlebell', 'band', 'banded', 'ezbar', 'smith', 'bodyweight', 'olympic', 'plate', 'trapbar', 'suspension', 'trx', 'resistance', 'elastic', 'assisted', 'weighted'])
const FILLER = new Set(['full', 'standard', 'regular', 'normal', 'basic', 'classic', 'medium', 'grip', 'traditional', 'conventional', 'bar'])

/** Equipment set as a comparable string ('bodyweight' and no equipment are the same). */
export function equipmentKey(equipment) {
  const set = new Set((equipment ?? []).map((e) => (e === 'olympic barbell' ? 'barbell' : e)).filter((e) => e !== 'bodyweight'))
  return [...set].sort().join('|')
}

/** Cross-source name key: name tokens without equipment/filler/side words. */
export function nameMatchKey(name, equipment = []) {
  const tokens = nameTokens(stripSide(name))
  const toks = tokens.filter((t) => !EQUIPMENT_WORDS.has(t) && !FILLER.has(t)).sort()
  // "Assisted"/"weighted" change the exercise: keep them when the equipment does not already say so.
  const extra = [...new Set(tokens.filter((t) => (t === 'assisted' || t === 'weighted') && !equipment.includes(t)))]
  return [...toks, ...extra].join(' ')
}

/** Cross-source match key: name key + equipment set. */
export function matchKey(name, equipment) {
  return `${nameMatchKey(name, equipment ?? [])}#${equipmentKey(equipment)}`
}

/**
 * Same equipment, allowing one side to list extra alternatives (wger "Front Raises" [barbell, dumbbell]
 * covers "Front Raise" [dumbbell]). Bodyweight and no equipment are the same; never matches bodyweight
 * against loaded equipment.
 */
export function equipmentCompatible(a, b) {
  const A = equipmentKey(a).split('|').filter(Boolean)
  const B = equipmentKey(b).split('|').filter(Boolean)
  if (!A.length || !B.length) return A.length === B.length
  return A.every((x) => B.includes(x)) || B.every((x) => A.includes(x))
}

const SIDE_RE = /,?\s*\b(?:left|right)(?:\s+(?:legs?|arms?|sides?))?\b/gi

/** Removes left/right qualifiers ("Calf raises, right leg" -> "Calf raises"). */
export function stripSide(name) {
  return String(name ?? '').replace(SIDE_RE, ' ').replace(/\s+/g, ' ').trim()
}

export function hasSide(name) {
  return new RegExp(SIDE_RE.source, 'i').test(String(name ?? ''))
}

// ---------------------------------------------------------------------------------------------
// Equipment and body-part inference from names

const SPECIFIC = new Set(['smith machine', 'EZ bar', 'trap bar', 'suspension trainer', 'stability ball', 'medicine ball', 'bosu ball', 'resistance band', 'assisted', 'weighted', 'ab wheel', 'roller', 'rope', 'sled machine', 'tire', 'hammer', 'towel', 'stationary bike', 'elliptical machine', 'stepmill machine', 'ski ergometer', 'leverage machine', 'cable', 'kettlebell', 'dumbbell', 'barbell'])

/** Equipment implied by the name alone (ordered, most specific first). */
export function equipmentFromName(name) {
  const n = ` ${String(name ?? '').toLowerCase()} `
  const out = []
  const add = (t) => { if (!out.includes(t)) out.push(t) }
  if (/smith|multi[\s-]?press/.test(n)) add('smith machine')
  if (/\b(?:ez|sz)[\s-]?bar\b/.test(n)) add('EZ bar')
  if (/trap[\s-]?bar|hex[\s-]?bar/.test(n)) add('trap bar')
  if (/\btrx\b|suspension|suspended|\brings?\b/.test(n)) add('suspension trainer')
  if (/swiss ball|stability[\s-]?ball|exercise ball|\bball (?:hamstring )?curl/.test(n)) add('stability ball')
  if (/medicine[\s-]?ball|med[\s-]?ball|wall[\s-]?balls?|ball slams?/.test(n)) add('medicine ball')
  if (/\bbosu\b/.test(n)) add('bosu ball')
  if (/\bbands?\b|\bbanded\b|elastic|flexbar/.test(n)) add('resistance band')
  if (/\bassisted\b/.test(n)) add('assisted')
  if (/^\s*weighted\b/.test(n)) add('weighted')
  if (/ab[\s-]?wheel|ab roller|leg wheel/.test(n)) add('ab wheel')
  if (/foam roller/.test(n)) add('roller')
  if (/battle ropes?|jump(?:ing)? rope|skipping/.test(n)) add('rope')
  if (/\bsled\b/.test(n)) add('sled machine')
  if (/\btyre\b|\btire\b/.test(n)) add('tire')
  if (/sledge ?hammer/.test(n)) add('hammer')
  if (/\btowel\b/.test(n)) add('towel')
  if (/\bbike\b|cycling|recumbent/.test(n)) add('stationary bike')
  if (/elliptical/.test(n)) add('elliptical machine')
  if (/stair ?master|stair climber|stepmill|climbmill/.test(n)) add('stepmill machine')
  if (/ski[\s-]?erg|ski machine/.test(n)) add('ski ergometer')
  const cardioMachine = /rowing|rower|treadmill|elliptical|bike|cycling|ski|stair|stepmill|climbmill/.test(n)
  if (!cardioMachine && !out.includes('smith machine') && !/band|elastic|glider|ball|dumbbell|nordic|towel|slider/.test(n) && /machine|\blever(?:age)?\b|pec deck|leg press|leg extension|leg curl|hack squat|hackenschmitt|hammer ?strength|calf press|pendulum squat|belt squat|glute drive|plate[\s-]?loaded|captain'?s chair|hip (?:abduction|adduction) machine|machine hip/.test(n)) add('leverage machine')
  if (/cable|pulley|lat pull|pulldown|pull down|face ?pull|pushdown|push down|cross[\s-]?over/.test(n) && !out.includes('leverage machine') && !out.includes('resistance band')) add('cable')
  if (/kettlebell|\bkb\b/.test(n)) add('kettlebell')
  if (/dumbbells?|dumbell|\bdb\b/.test(n)) add('dumbbell')
  if (/barbell|\bbb\b|landmine/.test(n) && !out.includes('smith machine')) add('barbell')
  return out
}

/** Merges source equipment with what the name says; specific terms replace "bodyweight". */
export function resolveEquipment(sourceTerms, name) {
  // Cardio on a machine we have no term for stays empty rather than wrong.
  if (/rowing machine|^\s*rowing\s*$|\brower\b|treadmill/i.test(name)) return []
  const fromName = equipmentFromName(name)
  let terms = [...new Set(sourceTerms.filter(Boolean))]
  if (fromName.includes('smith machine')) terms = terms.filter((t) => t !== 'barbell' && t !== 'leverage machine')
  if (fromName.includes('EZ bar')) terms = terms.filter((t) => t !== 'barbell')
  if (fromName.includes('trap bar')) terms = terms.filter((t) => t !== 'barbell')
  if (fromName.includes('assisted')) terms = terms.filter((t) => t !== 'leverage machine')
  if (!terms.length || (terms.length === 1 && terms[0] === 'bodyweight')) {
    const inferred = fromName.filter((t) => SPECIFIC.has(t))
    if (inferred.length) terms = inferred
  } else {
    for (const t of fromName) if (['smith machine', 'EZ bar', 'trap bar', 'suspension trainer', 'assisted', 'weighted', 'stability ball', 'medicine ball', 'bosu ball'].includes(t) && !terms.includes(t)) terms.push(t)
    if (terms.length > 1) terms = terms.filter((t) => t !== 'bodyweight')
  }
  if (!terms.length) terms = ['bodyweight']
  // "weighted" means plate/vest loading in this vocabulary; a named free weight already says it.
  if (terms.some((t) => ['dumbbell', 'kettlebell', 'barbell', 'medicine ball', 'EZ bar'].includes(t))) terms = terms.filter((t) => t !== 'weighted')
  return terms.slice(0, 3)
}

function bodyPartsFor(category, name) {
  const n = String(name).toLowerCase()
  const out = []
  if (/\bneck\b/.test(n)) out.push('neck')
  else if (category === 'Arms' && /wrist|forearm|grip|pinch|flexbar|tyler/.test(n)) out.push('lower arms')
  else if (WGER_CATEGORY[category]) out.push(WGER_CATEGORY[category])
  return out
}

// ---------------------------------------------------------------------------------------------
// wger mapping + selection

export const DESC_MIN = 40

/**
 * One wger exerciseinfo entry -> candidate row, or { drop: reason }.
 * `licenses` maps wger licence id -> { short_name, url }; `enId` is the English language id (2).
 */
export function mapWgerExercise(ex, { licenses = {}, enId = 2 } = {}) {
  const tr = (ex.translations ?? []).find((t) => t.language === enId)
  if (!tr) return { drop: 'no English translation' }
  const rawName = String(tr.name ?? '').trim()
  if (!isEnglishName(rawName)) return { drop: 'name is not English' }
  // Left/right copies ("Split squats left" / "... right") become one exercise without the side.
  const name = cleanName(stripSide(rawName) || rawName)
  if (!name || name.length > 120) return { drop: 'empty or too long name' }
  if (isJunkName(name)) return { drop: 'test/junk entry' }
  const plain = stripHtml(tr.description)
  if (plain.length <= DESC_MIN) return { drop: `description <= ${DESC_MIN} chars` }
  const primary = (ex.muscles ?? []).map((m) => WGER_MUSCLE[m.id]).filter(Boolean)
  const secondary = (ex.muscles_secondary ?? []).map((m) => WGER_MUSCLE[m.id]).filter(Boolean)
  if (!primary.length && !secondary.length) return { drop: 'no muscles' }
  const target = [...new Set(primary.length ? primary : secondary)]
  const second = [...new Set(secondary)].filter((m) => !target.includes(m))
  const equipment = resolveEquipment((ex.equipment ?? []).map((e) => WGER_EQUIPMENT[e.name] ?? null), name)
  const steps = descriptionToSteps(tr.description, tr.description_source)
  const textLicense = licenses[tr.license] ?? ex.license ?? {}
  return {
    row: {
      external_id: `wger:${ex.uuid}`,
      source: 'wger',
      name_en: name,
      body_parts: bodyPartsFor(ex.category?.name, name),
      target_muscles: target,
      secondary_muscles: second,
      equipment,
      instructions_en: steps,
    },
    meta: {
      wgerId: ex.id,
      variationGroup: ex.variation_group ?? null,
      descLength: plain.length,
      textCredit: {
        author: String(tr.license_author ?? '').trim() || String(ex.license_author ?? '').trim() || 'wger contributors',
        license: licenseName(textLicense.short_name),
        url: `https://wger.de/en/exercise/${ex.id}/view-base`,
      },
      images: ex.images ?? [],
    },
  }
}

/**
 * Applies the selection rules to wger exerciseinfo results.
 * Near-duplicates (same name key and equipment, e.g. "Side plank" / "Side plank right", or the same
 * name twice inside one variation group) keep the best-described entry.
 */
export function selectWger(results, opts = {}) {
  const dropped = []
  const candidates = []
  for (const ex of results) {
    const m = mapWgerExercise(ex, opts)
    if (m.drop) {
      const name = (ex.translations ?? []).find((t) => t.language === (opts.enId ?? 2))?.name ?? `#${ex.id}`
      dropped.push({ id: ex.id, name, reason: m.drop })
    } else candidates.push(m)
  }
  const better = (a, b) => (a.meta.descLength !== b.meta.descLength ? a.meta.descLength > b.meta.descLength : a.meta.wgerId < b.meta.wgerId)
  const ranked = [...candidates].sort((a, b) => (better(a, b) ? -1 : 1))
  const out = []
  const kept = new Map() // match key -> kept candidate
  const inGroup = new Map() // variation group + name key -> kept candidates
  for (const c of ranked) {
    const nk = nameMatchKey(c.row.name_en, c.row.equipment)
    // 1. Same name tokens and equipment anywhere in wger ('Machine Chest Press' / 'Leverage Machine Chest Press').
    const key = `${nk}#${equipmentKey(c.row.equipment)}`
    const dup = kept.get(key)
    // 2. Inside one variation group, the same name with overlapping equipment lists.
    const gk = `${c.meta.variationGroup}#${nk}`
    const g = c.meta.variationGroup ? inGroup.get(gk) ?? [] : []
    const groupDup = g.find((x) => equipmentCompatible(x.row.equipment, c.row.equipment))
    const winner = dup ?? groupDup
    if (winner) {
      dropped.push({ id: c.meta.wgerId, name: c.row.name_en, reason: `near-duplicate of wger #${winner.meta.wgerId} (${winner.row.name_en})` })
      continue
    }
    kept.set(key, c)
    if (c.meta.variationGroup) inGroup.set(gk, [...g, c])
    out.push(c)
  }
  out.sort((a, b) => a.meta.wgerId - b.meta.wgerId)
  return { selected: out, dropped }
}

// ---------------------------------------------------------------------------------------------
// workout-guide

export function wgFrameUrl(sha, path) {
  return `https://raw.githubusercontent.com/bryllim/workout-guide/${sha}/packages/workout-guide/${path}`
}

/** Media credit for a workout-guide exercise (frames by Bryl Lim, first frame possibly Everkinetic-derived). */
export function wgMediaCredit(entry, sha) {
  const src = entry.attribution?.source
  const everkinetic = /everkinetic/i.test(src?.name ?? '')
  return {
    author: everkinetic ? 'Bryl Lim / Everkinetic' : 'Bryl Lim',
    license: 'CC BY-SA 4.0',
    url: `${WG_REPO}/tree/${sha}/packages/workout-guide/assets/${entry.slug}`,
  }
}

export function wgChanges(entry) {
  const src = entry.attribution?.source
  return /everkinetic/i.test(src?.name ?? '') ? ['illustration: first frame adapted by Bryl Lim from Everkinetic (rasterized, recolored, vector-traced)'] : []
}

function wgEquipment(entry) {
  const base = WG_EQUIPMENT[entry.equipment]
  if (entry.equipment === 'Cardio' || base === null || base === undefined) {
    const fromName = equipmentFromName(entry.name).filter((t) => SPECIFIC.has(t))
    if (fromName.length) return fromName.slice(0, 2)
    if (/rowing|treadmill/i.test(entry.name)) return []
    return ['bodyweight']
  }
  return resolveEquipment([base], entry.name)
}

/** workout-guide manifest entry -> candidate row (instructions empty until written). */
export function mapWgExercise(entry, sha) {
  const target = [...new Set(WG_MUSCLE[entry.primaryMuscle] ?? [])]
  const secondary = [...new Set((entry.secondaryMuscles ?? []).flatMap((m) => WG_MUSCLE[m] ?? []))].filter((m) => !target.includes(m))
  const equipment = wgEquipment(entry)
  let bodyPart = WG_BODY_PART[entry.primaryMuscle] ?? null
  if (entry.equipment === 'Cardio' || entry.exerciseType === 'distance_duration' || entry.primaryMuscle === 'Cardio') bodyPart = 'cardio'
  if (!bodyPart) {
    // Mobility / stretches: body part from the first mapped secondary muscle, else upper legs.
    const first = (entry.secondaryMuscles ?? []).find((m) => WG_BODY_PART[m])
    bodyPart = first ? WG_BODY_PART[first] : 'upper legs'
  }
  const tgt = target.length ? target : secondary.slice(0, 1)
  return {
    row: {
      external_id: `wg:${entry.slug}`,
      source: 'workout-guide',
      name_en: cleanName(entry.name),
      body_parts: [bodyPart],
      target_muscles: tgt,
      secondary_muscles: secondary.filter((m) => !tgt.includes(m)),
      equipment,
      instructions_en: [],
    },
    meta: { slug: entry.slug, frames: framePaths(entry), sha },
  }
}

/** Ordered frames: storage path + source URL path. */
export function framePaths(entry) {
  return [...(entry.frames ?? [])]
    .filter((f) => String(f.format ?? '').toLowerCase() === 'svg' || /\.svg$/i.test(f.path ?? ''))
    .sort((a, b) => a.index - b.index)
    .map((f, i) => ({ storage: `frames/${entry.slug}/${i + 1}.svg`, source: f.path }))
}

// ---------------------------------------------------------------------------------------------
// Catalog build

/**
 * Builds the final catalog from wger exerciseinfo results and the workout-guide manifest.
 * workout-guide entries that match a selected wger row (same name tokens and equipment) lend it their
 * frames; the rest are added as their own rows. wger rows without frames may use allow-listed wger images.
 */
export function buildCatalog({ wgerResults, licenses = {}, enId = 2, wgManifest, sha }) {
  const { selected, dropped } = selectWger(wgerResults, { licenses, enId })
  const wg = (wgManifest ?? []).map((e) => ({ entry: e, ...mapWgExercise(e, sha) }))

  const wgerByName = new Map()
  for (const c of selected) {
    const k = nameMatchKey(c.row.name_en, c.row.equipment)
    if (!wgerByName.has(k)) wgerByName.set(k, [])
    wgerByName.get(k).push(c)
  }

  const rows = []
  const wgMatched = []
  const framesFor = new Map() // wger external_id -> wg item
  const wgAdded = []
  for (const w of wg) {
    const same = (wgerByName.get(nameMatchKey(w.row.name_en, w.row.equipment)) ?? []).filter((h) => equipmentCompatible(h.row.equipment, w.row.equipment))
    const exact = same.filter((h) => equipmentKey(h.row.equipment) === equipmentKey(w.row.equipment))
    const hits = exact.length ? exact : same
    if (hits.length) {
      for (const h of hits) if (!framesFor.has(h.row.external_id)) framesFor.set(h.row.external_id, w)
      wgMatched.push({ slug: w.meta.slug, wger: hits.map((h) => h.row.external_id) })
    } else wgAdded.push(w)
  }

  const stats = { wgerFetched: wgerResults.length, wgerSelected: selected.length, wgerDropped: dropped.length, wgTotal: wg.length, wgMatchedToWger: wgMatched.length, wgAdded: wgAdded.length, withFrames: 0, withWgerImages: 0, noMedia: 0 }

  for (const c of selected) {
    const w = framesFor.get(c.row.external_id)
    const changes = []
    if (c.row.instructions_en.length) changes.push('instructions: wger description split into steps')
    changes.push('muscles, equipment and body part mapped to the app vocabulary')
    let media = null
    let frames = []
    if (w && w.meta.frames.length) {
      frames = w.meta.frames.map((f) => ({ ...f, url: wgFrameUrl(sha, f.source), contentType: 'image/svg+xml' }))
      media = wgMediaCredit(w.entry, sha)
      changes.push(...wgChanges(w.entry))
      stats.withFrames++
    } else {
      const allowed = [...c.meta.images]
        .map((img) => ({ img, cls: classifyWgerImage(img), type: imageType(img.image) }))
        .filter((x) => x.cls && x.cls !== 'red' && x.type)
        .sort((a, b) => Number(b.img.is_main) - Number(a.img.is_main) || a.img.id - b.img.id)
      // One credit line per row: only frames with the first frame's class and licence.
      const imgs = allowed.filter((x) => x.cls === allowed[0]?.cls && x.img.license === allowed[0]?.img.license).slice(0, 4)
      if (imgs.length) {
        frames = imgs.map((x, i) => ({ storage: `frames/wger-${c.meta.wgerId}/${i + 1}.${x.type.ext}`, url: x.img.image, contentType: x.type.contentType }))
        const first = imgs[0]
        const uploader = String(first.img.license_author ?? '').trim()
        const author =
          first.cls === 'ai' ? 'AI-generated image (wger)' : first.cls === 'everkinetic' ? 'Everkinetic' : `${uploader || 'wger contributors'} via Wikimedia Commons`
        const url = first.cls === 'wikimedia' && first.img.license_object_url ? first.img.license_object_url : `https://wger.de/en/exercise/${c.meta.wgerId}/view-base`
        media = { author, license: licenseName(licenses[first.img.license]?.short_name), url }
        stats.withWgerImages++
      } else stats.noMedia++
    }
    rows.push({
      ...c.row,
      attribution: { text: c.meta.textCredit, media, changes },
      _frames: frames,
      _origin: { wgerId: c.meta.wgerId, wgSlug: w?.meta.slug ?? null },
    })
  }
  for (const w of wgAdded) {
    const frames = w.meta.frames.map((f) => ({ ...f, url: wgFrameUrl(sha, f.source), contentType: 'image/svg+xml' }))
    if (frames.length) stats.withFrames++
    else stats.noMedia++
    rows.push({
      ...w.row,
      attribution: {
        text: { author: 'Bryl Lim (workout-guide)', license: 'MIT', url: `${WG_REPO}/blob/${sha}/packages/workout-guide/manifest.json` },
        media: frames.length ? wgMediaCredit(w.entry, sha) : null,
        changes: ['muscles, equipment and body part mapped to the app vocabulary', ...wgChanges(w.entry)],
      },
      _frames: frames,
      _origin: { wgerId: null, wgSlug: w.meta.slug },
    })
  }
  stats.total = rows.length
  return { rows, dropped, wgMatched, stats }
}

// ---------------------------------------------------------------------------------------------
// Core lifts (docs/catalog-v2-spec.md "Selection")

export const CORE_LIFTS = [
  { lift: 'Back squat (barbell)', re: /^(?:barbell )?(?:back |full )?squats?$|^barbell full squat$/i, eq: 'barbell' },
  { lift: 'Front squat', re: /front squat/i },
  { lift: 'Bench press (barbell)', re: /^(?:barbell )?(?:flat )?bench ?press$/i, eq: 'barbell' },
  { lift: 'Dumbbell bench press', re: /bench ?press|dumbbell press/i, eq: 'dumbbell' },
  { lift: 'Deadlift (barbell)', re: /^(?:barbell |conventional )?deadlifts?$/i },
  { lift: 'Romanian deadlift', re: /romanian deadlift|\brdl\b/i },
  { lift: 'Overhead press', re: /overhead (?:barbell )?press|shoulder press|military press/i },
  { lift: 'Barbell row', re: /bent[\s-]?over row|barbell row|pendlay|pendelay/i },
  { lift: 'Dumbbell row', re: /(?:one[\s-]arm|single[\s-]arm|dumbbell).*row/i, eq: 'dumbbell' },
  { lift: 'Seated cable row', re: /seated (?:cable )?row|cable row|long[\s-]?pulley/i },
  { lift: 'Lat pulldown', re: /lat pull ?down|pulldown/i },
  { lift: 'Pull-up', re: /pull[\s-]?ups?\b/i },
  { lift: 'Chin-up', re: /chin[\s-]?ups?\b/i },
  { lift: 'Lunge', re: /lunges?\b/i },
  { lift: 'Dips', re: /\bdips?\b/i },
  { lift: 'Hip thrust', re: /hip thrust/i },
  { lift: 'Leg press', re: /^leg press(?:es)?$/i },
  { lift: 'Biceps curl', re: /bicep|^(?:dumbbell |barbell )?curls?$/i },
  { lift: 'Hammer curl', re: /hammer ?curl/i },
  { lift: 'Triceps pushdown', re: /tricep.*push ?down|push ?down/i },
  { lift: 'Overhead triceps extension / skull crusher', re: /overhead tricep|skull ?crush|lying triceps extension/i },
  { lift: 'Lateral raise', re: /lateral raise/i },
  { lift: 'Plank', re: /^(?:front )?plank$/i },
  { lift: 'Push-up', re: /^push[\s-]?ups?$/i },
  { lift: 'Leg extension', re: /^leg extensions?$/i },
  { lift: 'Leg curl', re: /leg curl/i },
  { lift: 'Calf raise', re: /calf raise/i },
  { lift: 'Cable fly / crossover', re: /cable (?:fly|cross ?over)|cable cross-over|crossover/i },
  { lift: 'Machine chest press', re: /chest press/i, eq: 'leverage machine' },
  { lift: 'Pec deck / machine fly', re: /pec deck|machine (?:chest )?fly|butterfly$/i },
  { lift: 'Face pull', re: /face ?pull/i },
  { lift: 'Shrug', re: /shrug/i },
  { lift: 'Running', re: /^running$|\brun\b|jog/i },
  { lift: 'Cycling', re: /cycling|bike/i },
  { lift: 'Rowing (machine)', re: /^rowing(?: machine)?$/i },
]

/** For each core lift, the selected names that satisfy it. */
export function checkCoreLifts(rows) {
  return CORE_LIFTS.map((c) => {
    const found = rows.filter((r) => c.re.test(r.name_en) && (!c.eq || r.equipment.includes(c.eq))).map((r) => r.name_en)
    return { lift: c.lift, ok: found.length > 0, found: found.slice(0, 6) }
  })
}

// ---------------------------------------------------------------------------------------------
// Translation

export const TRANSLATE_BATCH = 20
export const NAME_TR_MAX = 120
export const STEP_TR_MAX = 600

export const TRANSLATE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      id: { type: 'STRING' },
      name_tr: { type: 'STRING' },
      instructions_tr: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['id', 'name_tr', 'instructions_tr'],
    propertyOrdering: ['id', 'name_tr', 'instructions_tr'],
  },
}

export function isFlashLite(model) {
  return /^gemini-[\d.]+-flash-lite(?:-[a-z0-9.-]+)?$/i.test(String(model ?? ''))
}

/** Prompt for one batch; `examples` are curated [en, tr] pairs that show the house style. */
export function buildTranslatePrompt(items, examples = []) {
  return [
    'Translate these gym exercises into Turkish for a fitness app used in Turkey.',
    'name_tr: the short name Turkish gym-goers actually use. Keep established English gym terms (Bench Press, Deadlift, Squat, Lat Pulldown, Hip Thrust, Romanian Deadlift, Face Pull...)',
    'and translate equipment and simple words: dumbbell -> Dambıl, barbell -> Halter, cable -> Kablo, machine -> Makine, push-up -> Şınav, pull-up -> Barfiks, incline/decline stay as is, plank -> Plank.',
    'instructions_tr: translate every step of instructions_en, one Turkish step per English step, same order, same count; plain imperative Turkish (sen dili), no numbering, no markdown.',
    'If instructions_en is empty return an empty instructions_tr array. Return JSON only, one object per input id.',
    examples.length ? `House style examples (en -> tr): ${examples.map(([en, tr]) => `"${en}" -> "${tr}"`).join('; ')}` : '',
    'Items:',
    JSON.stringify(items.map((r) => ({ id: r.id, name_en: r.name_en, instructions_en: r.instructions_en }))),
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Validates model output against the batch. Returns accepted translations and per-id rejections.
 * Rules: known id, name 1..120 chars and not absurdly long vs English, step count equal to the English
 * step count, every step 1..600 chars, no leftover markup.
 */
export function validateTranslations(items, output) {
  const byId = new Map(items.map((r) => [r.id, r]))
  const accepted = []
  const rejected = []
  const seen = new Set()
  if (!Array.isArray(output)) return { accepted, rejected: items.map((r) => ({ id: r.id, reason: 'response is not an array' })) }
  for (const o of output) {
    const src = byId.get(o?.id)
    if (!src || seen.has(o.id)) continue
    seen.add(o.id)
    const name = typeof o.name_tr === 'string' ? o.name_tr.replace(/\s+/g, ' ').trim() : ''
    const steps = Array.isArray(o.instructions_tr) ? o.instructions_tr.map((s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')) : null
    let reason = null
    if (!name || name.length > NAME_TR_MAX) reason = `name_tr length ${name.length}`
    else if (name.length > src.name_en.length * 3 + 20) reason = 'name_tr much longer than the English name'
    else if (/[<>{}`*#]|\n/.test(name)) reason = 'name_tr contains markup'
    else if (!steps) reason = 'instructions_tr missing'
    else if (steps.length !== src.instructions_en.length) reason = `instructions_tr has ${steps.length} steps, expected ${src.instructions_en.length}`
    else if (steps.some((s) => !s || s.length > STEP_TR_MAX)) reason = 'instructions_tr step empty or too long'
    else if (steps.some((s) => /<[a-z/][^>]*>|```/i.test(s))) reason = 'instructions_tr contains markup'
    if (reason) rejected.push({ id: o.id, reason })
    else accepted.push({ id: o.id, name_tr: name, instructions_tr: steps })
  }
  for (const r of items) if (!seen.has(r.id)) rejected.push({ id: r.id, reason: 'missing from response' })
  return { accepted, rejected }
}

/** Adds the machine-translation note to an attribution object (idempotent). */
export function withMachineTranslation(attribution) {
  const a = attribution && typeof attribution === 'object' ? attribution : { text: null, media: null, changes: [] }
  const changes = Array.isArray(a.changes) ? a.changes : []
  return { ...a, changes: changes.includes(MACHINE_TRANSLATION) ? changes : [...changes, MACHINE_TRANSLATION] }
}

/** Keeps the machine-translation note of an existing row when the sync rewrites its attribution. */
export function mergeAttribution(next, existing) {
  if (Array.isArray(existing?.changes) && existing.changes.includes(MACHINE_TRANSLATION)) return withMachineTranslation(next)
  return next
}

/** Pacific calendar day (Gemini daily quotas reset at midnight Pacific time). */
export function pacificDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(date)
}
