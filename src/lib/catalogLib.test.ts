import { describe, expect, it } from 'vitest'
import {
  BODY_PARTS,
  MACHINE_TRANSLATION,
  TRANSLATE_BATCH,
  TRANSLATE_SCHEMA,
  WGER_CATEGORY,
  WGER_EQUIPMENT,
  WGER_MUSCLE,
  WG_BODY_PART,
  WG_EQUIPMENT,
  WG_MUSCLE,
  buildCatalog,
  checkCoreLifts,
  classifyWgerImage,
  cleanName,
  descriptionToSteps,
  equipmentCompatible,
  equipmentFromName,
  isEnglishName,
  isFlashLite,
  isJunkName,
  isSafeSvg,
  licenseName,
  matchKey,
  mergeAttribution,
  nameKey,
  resolveEquipment,
  selectWger,
  validateTranslations,
  withMachineTranslation,
  // @ts-expect-error -- plain ESM helper shared with the Node sync script (no type declarations)
} from '../../scripts/catalog-lib.mjs'
import aliases from '../../scripts/muscle-aliases.json'
import en from '../locales/en/exercises.json'
import { vocabKey } from '../features/exercises/name'

type Row = { external_id: string; source: string; name_en: string; equipment: string[]; body_parts: string[]; target_muscles: string[]; secondary_muscles: string[]; instructions_en: string[]; attribution: Record<string, unknown>; _frames: { storage: string }[] }

const muscleTerms = new Set(Object.keys((aliases as { aliases: Record<string, number | null> }).aliases))
const equipmentKeys = new Set(Object.keys((en as { equipment: Record<string, string> }).equipment))
const bodyPartKeys = new Set(Object.keys((en as { bodyPart: Record<string, string> }).bodyPart))

const desc = '<ol><li>Stand tall with the weight in both hands.</li><li>Lower it under control and press back up.</li></ol>'
let nextId = 1
function wger(name: string, opts: { equipment?: string[]; muscles?: number[]; secondary?: number[]; description?: string; category?: string; group?: string | null; images?: unknown[] } = {}) {
  const id = nextId++
  return {
    id,
    uuid: `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`,
    category: { id: 1, name: opts.category ?? 'Chest' },
    muscles: (opts.muscles ?? [4]).map((m) => ({ id: m })),
    muscles_secondary: (opts.secondary ?? []).map((m) => ({ id: m })),
    equipment: (opts.equipment ?? ['Barbell']).map((name) => ({ name })),
    license: { id: 2, short_name: 'CC-BY-SA 4' },
    license_author: 'someone',
    variation_group: opts.group ?? null,
    images: opts.images ?? [],
    translations: [{ language: 2, name, description: opts.description ?? desc, description_source: '', license: 2, license_author: 'author1' }],
  }
}
const licenses = { 1: { short_name: 'CC-BY-SA 3' }, 2: { short_name: 'CC-BY-SA 4' }, 3: { short_name: 'CC0' } }
const frames = (slug: string) => [1, 2, 3].map((i) => ({ index: i, path: `assets/${slug}/frame-${i}.svg`, format: 'svg' }))
function wg(slug: string, name: string, equipment: string, primaryMuscle = 'Chest', everkinetic = false) {
  return {
    slug,
    name,
    equipment,
    primaryMuscle,
    secondaryMuscles: ['Triceps'],
    exerciseType: 'weight_reps',
    isStretch: false,
    frames: frames(slug),
    attribution: { creator: 'Bryl Lim', ...(everkinetic ? { source: { name: 'Everkinetic' } } : {}) },
  }
}

describe('vocabulary maps stay inside the existing terms', () => {
  it('muscles exist in scripts/muscle-aliases.json', () => {
    for (const m of Object.values(WGER_MUSCLE) as string[]) expect(muscleTerms.has(m), m).toBe(true)
    for (const m of (Object.values(WG_MUSCLE) as string[][]).flat()) expect(muscleTerms.has(m), m).toBe(true)
  })
  it('body parts and equipment have locale keys', () => {
    for (const b of [...BODY_PARTS, ...(Object.values(WGER_CATEGORY) as string[]), ...(Object.values(WG_BODY_PART).filter(Boolean) as string[])]) expect(bodyPartKeys.has(vocabKey(b)), b).toBe(true)
    const eq = [...(Object.values(WGER_EQUIPMENT) as (string | null)[]), ...(Object.values(WG_EQUIPMENT) as (string | null)[])].filter(Boolean) as string[]
    const names = ['Smith machine squat', 'EZ-bar curl', 'Trap bar deadlift', 'TRX rows', 'Swiss ball crunch', 'Wall balls', 'Bosu squat', 'Banded row', 'Assisted dip', 'Weighted pull-up', 'Ab wheel rollout', 'Foam roller quads', 'Battle ropes', 'Sled push', 'Tire flip', 'Sledgehammer swing', 'Towel row', 'Recumbent bike', 'Elliptical', 'Stair master', 'Ski erg', 'Leg press', 'Cable fly', 'Kettlebell swing', 'Dumbbell curl', 'Landmine press']
    for (const n of names) eq.push(...equipmentFromName(n))
    for (const e of eq) expect(equipmentKeys.has(vocabKey(e)), e).toBe(true)
  })
})

describe('text helpers', () => {
  it('splits wger descriptions into steps', () => {
    expect(descriptionToSteps(desc, '')).toEqual(['Stand tall with the weight in both hands.', 'Lower it under control and press back up.'])
    expect(descriptionToSteps('<p>First paragraph here.</p><p>Second &amp; last.</p>', '')).toEqual(['First paragraph here.', 'Second & last.'])
    expect(descriptionToSteps('<p>x</p>', '1. Grip the bar.\n2. Pull it up.')).toEqual(['Grip the bar.', 'Pull it up.'])
  })
  it('cleans names and rejects non-English and junk entries', () => {
    expect(cleanName('Bodyweight Squat HD')).toBe('Bodyweight Squat')
    expect(cleanName('Low-Cable Cross-Over - NB')).toBe('Low-Cable Cross-Over')
    expect(cleanName('bicycle crunches')).toBe('Bicycle crunches')
    expect(isEnglishName('Military Press mit SZ-Bar')).toBe(false)
    expect(isEnglishName('Jalón al pecho con agarre ancho')).toBe(false)
    expect(isEnglishName('Remo alto polea alta')).toBe(false)
    expect(isEnglishName("Devil’s Press")).toBe(true)
    expect(isEnglishName('Push-Ups | Incline')).toBe(true)
    expect(isJunkName('3008 Abdominal Crunch')).toBe(true)
    expect(isJunkName('Bear Walk 2')).toBe(true)
    expect(isJunkName('biceps')).toBe(true)
    expect(isJunkName('Lying Dumbbell Row SS Seated Shrug')).toBe(true)
    expect(isJunkName('Hammer Curls')).toBe(false)
  })
  it('maps wger licences to display names', () => {
    expect(licenseName('CC-BY-SA 4')).toBe('CC BY-SA 4.0')
    expect(licenseName('CC-BY-SA 3')).toBe('CC BY-SA 3.0')
    expect(licenseName('CC-BY 4')).toBe('CC BY 4.0')
    expect(licenseName('CC0')).toBe('CC0 1.0')
  })
})

describe('name matching', () => {
  it('folds spelling variants, plurals, order and sides', () => {
    expect(nameKey('Push-Ups')).toBe(nameKey('pushup'))
    expect(nameKey('Calf raises, right leg')).toBe(nameKey('Calf Raise'))
    expect(nameKey('Bulgarian split squats left')).toBe(nameKey('Bulgarian Split Squat'))
    expect(nameKey('Seated Cable Row')).toBe(nameKey('cable seated row'))
    expect(nameKey('Side to Side Push Ups')).not.toBe(nameKey('Side Push-Up'))
    expect(nameKey('Leg Presses (wide)')).not.toBe(nameKey('Leg Press'))
  })
  it('compares names across sources without equipment words', () => {
    expect(matchKey('barbell bench press', ['barbell'])).toBe(matchKey('Bench Press', ['barbell']))
    expect(matchKey('dumbbell bench press', ['dumbbell'])).toBe(matchKey('Benchpress Dumbbells', ['dumbbell']))
    expect(matchKey('lever leg extension', ['leverage machine'])).toBe(matchKey('Leg Extension', ['leverage machine']))
    expect(matchKey('barbell romanian deadlift', ['barbell'])).toBe(matchKey('Barbell Romanian Deadlift (RDL)', ['barbell']))
    expect(matchKey('dumbbell bench press', ['dumbbell'])).not.toBe(matchKey('Bench Press', ['barbell']))
    expect(matchKey('weighted pull-up', ['bodyweight'])).not.toBe(matchKey('Pull-up', ['bodyweight']))
  })
  it('treats bodyweight as no equipment and allows listed alternatives', () => {
    expect(equipmentCompatible(['bodyweight'], [])).toBe(true)
    expect(equipmentCompatible(['dumbbell'], ['barbell', 'dumbbell'])).toBe(true)
    expect(equipmentCompatible(['dumbbell'], ['barbell'])).toBe(false)
    expect(equipmentCompatible(['bodyweight'], ['dumbbell'])).toBe(false)
  })
})

describe('equipment inference', () => {
  it('uses the name where the source is vague and never invents a term', () => {
    expect(resolveEquipment(['barbell'], 'Smith machine squat')).toEqual(['smith machine'])
    expect(resolveEquipment([], 'Leg Press')).toEqual(['leverage machine'])
    expect(resolveEquipment(['bodyweight'], 'Rowing with TRX band')).toContain('suspension trainer')
    expect(resolveEquipment(['bodyweight'], 'Rowing Machine')).toEqual([])
    expect(resolveEquipment([], 'Treadmill Incline Walk')).toEqual([])
    expect(resolveEquipment([], 'Pistol Squat')).toEqual(['bodyweight'])
    expect(resolveEquipment(['dumbbell'], 'Weighted Russian Twist')).toEqual(['dumbbell'])
    expect(resolveEquipment(['leverage machine'], 'Assisted Pull-up')).toEqual(['assisted'])
    expect(resolveEquipment(['bodyweight'], 'Recumbent Bike')).toEqual(['stationary bike'])
  })
})

describe('selection', () => {
  it('applies the spec filters and keeps the best-described near-duplicate', () => {
    const results = [
      wger('Bench Press'),
      wger('Military Press mit SZ-Bar'),
      wger('Short one', { description: '<p>Too short.</p>' }),
      wger('No muscle', { muscles: [], secondary: [] }),
      wger('Side plank right', { equipment: ['none (bodyweight exercise)'], category: 'Abs', muscles: [6] }),
      wger('Side Plank', { equipment: ['none (bodyweight exercise)'], category: 'Abs', muscles: [6], description: `${desc}<p>Extra detail makes this the better description.</p>` }),
      wger('Machine Chest Press', { equipment: [] }),
      wger('Leverage Machine Chest Press', { equipment: [], description: `${desc}<p>Longer.</p>` }),
      wger('Squats', { group: 'g1', category: 'Legs', muscles: [10] }),
      wger('Front Squats', { group: 'g1', category: 'Legs', muscles: [10] }),
    ]
    const { selected, dropped } = selectWger(results, { licenses })
    const names = selected.map((c: { row: Row }) => c.row.name_en)
    expect(names).toEqual(['Bench Press', 'Side Plank', 'Leverage Machine Chest Press', 'Squats', 'Front Squats'])
    const reasons = Object.fromEntries(dropped.map((d: { name: string; reason: string }) => [d.name, d.reason]))
    expect(reasons['Military Press mit SZ-Bar']).toBe('name is not English')
    expect(reasons['Short one']).toMatch(/description/)
    expect(reasons['No muscle']).toBe('no muscles')
    expect(reasons['Side plank']).toMatch(/near-duplicate/)
    expect(reasons['Machine Chest Press']).toMatch(/near-duplicate/)
  })
  it('maps wger fields onto the app vocabulary', () => {
    const { selected } = selectWger([wger('Biceps Curls With SZ-bar', { equipment: ['SZ-Bar'], category: 'Arms', muscles: [1], secondary: [13, 1] })], { licenses })
    const r = selected[0].row as Row
    expect(r.external_id).toMatch(/^wger:/)
    expect(r.body_parts).toEqual(['upper arms'])
    expect(r.target_muscles).toEqual(['biceps'])
    expect(r.secondary_muscles).toEqual(['brachialis'])
    expect(r.equipment).toEqual(['EZ bar'])
  })
})

describe('catalog build', () => {
  const wgerResults = [
    wger('Bench Press', { equipment: ['Barbell', 'Bench'] }),
    wger('Lateral Raises', { equipment: ['Dumbbell'], category: 'Shoulders', muscles: [2] }),
    wger('Crunches', {
      equipment: ['Gym mat'],
      category: 'Abs',
      muscles: [6],
      images: [
        { id: 1, image: 'https://wger.de/media/a.png', is_main: true, license: 1, license_author: 'Everkinetic', is_ai_generated: false },
        { id: 2, image: 'https://wger.de/media/b.png', is_main: false, license: 2, license_author: "Men's Health", is_ai_generated: false },
      ],
    }),
  ]
  const manifest = [wg('bench-press', 'Bench Press', 'Barbell', 'Chest', true), wg('cable-fly', 'Cable Fly', 'Cable')]
  const { rows, stats } = buildCatalog({ wgerResults, licenses, wgManifest: manifest, sha: 'abc123' }) as { rows: Row[]; stats: Record<string, number> }

  it('lends workout-guide frames to the matching wger row and adds the rest', () => {
    expect(stats.total).toBe(4)
    const bench = rows.find((r) => r.name_en === 'Bench Press')!
    expect(bench.source).toBe('wger')
    expect(bench._frames.map((f) => f.storage)).toEqual(['frames/bench-press/1.svg', 'frames/bench-press/2.svg', 'frames/bench-press/3.svg'])
    const fly = rows.find((r) => r.external_id === 'wg:cable-fly')!
    expect(fly.source).toBe('workout-guide')
    expect(fly.instructions_en).toEqual([])
    expect(fly.equipment).toEqual(['cable'])
  })
  it('uses only allow-listed wger images, never red-flag ones', () => {
    const crunch = rows.find((r) => r.name_en === 'Crunches')!
    expect(crunch._frames.map((f) => f.storage)).toEqual([expect.stringMatching(/^frames\/wger-\d+\/1\.png$/)])
    expect((crunch.attribution.media as { author: string; license: string }).license).toBe('CC BY-SA 3.0')
  })
  it('writes attribution in the spec shape', () => {
    for (const r of rows) {
      expect(Object.keys(r.attribution).sort()).toEqual(['changes', 'media', 'text'])
      expect(Object.keys(r.attribution.text as object).sort()).toEqual(['author', 'license', 'url'])
      if (r.attribution.media) expect(Object.keys(r.attribution.media as object).sort()).toEqual(['author', 'license', 'url'])
      expect(Array.isArray(r.attribution.changes)).toBe(true)
    }
    const bench = rows.find((r) => r.name_en === 'Bench Press')!
    expect(bench.attribution.text).toEqual({ author: 'author1', license: 'CC BY-SA 4.0', url: expect.stringMatching(/^https:\/\/wger\.de\/en\/exercise\/\d+\/view-base$/) })
    expect(bench.attribution.media).toEqual({ author: 'Bryl Lim / Everkinetic', license: 'CC BY-SA 4.0', url: expect.stringContaining('/tree/abc123/') })
    const fly = rows.find((r) => r.external_id === 'wg:cable-fly')!
    expect((fly.attribution.text as { license: string }).license).toBe('MIT')
  })
  it('reports core lifts by name', () => {
    const res = checkCoreLifts(rows) as { lift: string; ok: boolean }[]
    expect(res.find((c) => c.lift === 'Bench press (barbell)')?.ok).toBe(true)
    expect(res.find((c) => c.lift === 'Leg press')?.ok).toBe(false)
  })
})

describe('media allow-list', () => {
  it('classifies wger images', () => {
    expect(classifyWgerImage({ license_author: 'Everkinetic' })).toBe('everkinetic')
    expect(classifyWgerImage({ license_author: 'x', is_ai_generated: true })).toBe('ai')
    expect(classifyWgerImage({ license_author: 'x', license_object_url: 'https://commons.wikimedia.org/wiki/File:A.png' })).toBe('wikimedia')
    expect(classifyWgerImage({ license_author: 'Workout Guru', is_ai_generated: true })).toBe('red')
    expect(classifyWgerImage({ license_author: 'x', license_derivative_source_url: 'https://www.menshealth.com/a' })).toBe('red')
    expect(classifyWgerImage({ license_author: 'random user' })).toBeNull()
  })
  it('rejects SVGs with active content', () => {
    expect(isSafeSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')).toBe(true)
    expect(isSafeSvg('<svg><script>alert(1)</script></svg>')).toBe(false)
    expect(isSafeSvg('<svg><rect onload="x()"/></svg>')).toBe(false)
    expect(isSafeSvg('<svg><a href="javascript:x"/></svg>')).toBe(false)
    expect(isSafeSvg('<html></html>')).toBe(false)
  })
})

describe('translation', () => {
  const items = [
    { id: 'wger:1', name_en: 'Bench Press', instructions_en: ['Lie on the bench.', 'Press the bar.'] },
    { id: 'wg:x', name_en: 'Cable Fly', instructions_en: [] },
    { id: 'wger:2', name_en: 'Plank', instructions_en: ['Hold.'] },
    { id: 'wger:3', name_en: 'Squat', instructions_en: ['Sit down.'] },
  ]
  it('uses Flash Lite only, 20 per request, with a strict schema', () => {
    expect(isFlashLite('gemini-3.5-flash-lite')).toBe(true)
    expect(isFlashLite('gemini-3.8-flash')).toBe(false)
    expect(isFlashLite('gemini-2.5-pro')).toBe(false)
    expect(TRANSLATE_BATCH).toBe(20)
    expect(TRANSLATE_SCHEMA.items.required).toEqual(['id', 'name_tr', 'instructions_tr'])
  })
  it('validates ids, lengths and step counts', () => {
    const { accepted, rejected } = validateTranslations(items, [
      { id: 'wger:1', name_tr: 'Halter Bench Press', instructions_tr: ['Sehpaya uzan.', 'Barı it.'] },
      { id: 'wg:x', name_tr: 'Kablo Fly', instructions_tr: [] },
      { id: 'wger:2', name_tr: 'Plank', instructions_tr: ['Tut.', 'Fazladan adım.'] },
      { id: 'unknown', name_tr: 'x', instructions_tr: [] },
      { id: 'wger:3', name_tr: 'x'.repeat(121), instructions_tr: ['Otur.'] },
    ])
    expect(accepted.map((a: { id: string }) => a.id)).toEqual(['wger:1', 'wg:x'])
    expect(Object.fromEntries(rejected.map((r: { id: string; reason: string }) => [r.id, r.reason]))).toEqual({
      'wger:2': 'instructions_tr has 2 steps, expected 1',
      'wger:3': 'name_tr length 121',
    })
    expect(validateTranslations(items, { not: 'an array' }).rejected).toHaveLength(4)
  })
  it('records machine translation in attribution.changes once, and keeps it on re-sync', () => {
    const a = { text: { author: 'a', license: 'CC0 1.0', url: 'u' }, media: null, changes: ['x'] }
    const once = withMachineTranslation(a)
    expect(once.changes).toEqual(['x', MACHINE_TRANSLATION])
    expect(withMachineTranslation(once).changes).toEqual(['x', MACHINE_TRANSLATION])
    expect(mergeAttribution(a, once).changes).toEqual(['x', MACHINE_TRANSLATION])
    expect(mergeAttribution(a, null).changes).toEqual(['x'])
  })
})
