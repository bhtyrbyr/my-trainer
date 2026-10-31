// Tests for the coach-program helpers (supabase/functions/ai-coach/coach.ts) and the template naming.
import { describe, expect, it } from 'vitest'
import {
  PROGRAM_MAX_DAYS,
  PROGRAM_MAX_EXERCISES,
  applyMatches,
  buildProgramPrompt,
  nameScore,
  nameTokens,
  normalizeProgram,
  parseModelJson,
  pickBestMatch,
  programSummary,
  searchTokens,
  type CatalogCandidate,
} from '../../../supabase/functions/ai-coach/coach'
import { PROGRAM_SLOT, programRequestOf, programTemplateName } from './logic'

const fallback = { name: 'Program', day: (n: number) => `Day ${n}` }
const ex = (name_en: string, sets = 3, reps = 10, rest_sec = 90) => ({ name_en, sets, reps, rest_sec })
const row = (id: string, name_en: string, source = 'wger', name_tr: string | null = null): CatalogCandidate => ({ id, name_en, name_tr, source })

describe('parseModelJson', () => {
  it('reads plain, fenced and prose-wrapped JSON', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseModelJson('Here you go:\n{"a":{"b":2}}\nEnjoy!')).toEqual({ a: { b: 2 } })
  })
  it('returns null for unreadable text', () => {
    expect(parseModelJson('no json here')).toBeNull()
    expect(parseModelJson('{broken')).toBeNull()
  })
})

describe('normalizeProgram', () => {
  it('clamps sets, reps and rest and rounds them', () => {
    const p = normalizeProgram(
      { name: 'Plan', days: [{ name: 'A', exercises: [{ name_en: 'Squat', sets: 20, reps: 0, rest_sec: 5 }, { name_en: 'Row', sets: '2.6', reps: 99, rest_sec: 1000 }] }] },
      fallback,
    )!
    expect(p.days[0].exercises).toEqual([
      { name_en: 'Squat', sets: 8, reps: 1, rest_sec: 30 },
      { name_en: 'Row', sets: 3, reps: 30, rest_sec: 300 },
    ])
  })
  it('uses defaults for missing numbers and fallbacks for missing names', () => {
    const p = normalizeProgram({ days: [{ exercises: [{ name_en: 'Plank', sets: null, reps: 'x' }] }] }, fallback)!
    expect(p.name).toBe('Program')
    expect(p.notes).toBeNull()
    expect(p.days[0]).toEqual({ name: 'Day 1', exercises: [{ name_en: 'Plank', sets: 3, reps: 10, rest_sec: 90 }] })
  })
  it('caps days and exercises per day', () => {
    const day = { name: 'D', exercises: Array.from({ length: 12 }, (_, i) => ex(`Ex ${i}`)) }
    const p = normalizeProgram({ name: 'P', days: Array.from({ length: 9 }, () => day) }, fallback)!
    expect(p.days).toHaveLength(PROGRAM_MAX_DAYS)
    expect(p.days.every((d) => d.exercises.length === PROGRAM_MAX_EXERCISES)).toBe(true)
  })
  it('drops nameless exercises and empty days, and single-lines and caps strings', () => {
    const p = normalizeProgram(
      {
        name: `  Big\n\nplan ${'x'.repeat(100)}`,
        notes: '   ',
        days: [{ name: 'Empty', exercises: [{ name_en: '  ' }, null, 'Squat'] }, { name: 'Real', exercises: [ex('Squat')] }],
      },
      fallback,
    )!
    expect(p.name.startsWith('Big plan')).toBe(true)
    expect(p.name.length).toBeLessThanOrEqual(60)
    expect(p.notes).toBeNull()
    expect(p.days.map((d) => d.name)).toEqual(['Real'])
  })
  it('returns null when nothing usable is left', () => {
    expect(normalizeProgram(null, fallback)).toBeNull()
    expect(normalizeProgram('text', fallback)).toBeNull()
    expect(normalizeProgram({ days: [{ name: 'A', exercises: [] }] }, fallback)).toBeNull()
  })
})

describe('name matching', () => {
  it('tokenises: case, punctuation, plural s and stopwords ignored', () => {
    expect(nameTokens('Push-Ups (with Dumbbells)')).toEqual(['push', 'up', 'dumbbell'])
    expect(nameTokens('Bench Press')).toEqual(['bench', 'press'])
  })
  it('search tokens are distinct, longest first, at most three', () => {
    expect(searchTokens('Incline Dumbbell Bench Press')).toEqual(['dumbbell', 'incline', 'bench'])
    expect(searchTokens('the of')).toEqual([])
  })
  it('scores same words as 1 and partial overlaps by Dice', () => {
    expect(nameScore('Squats', 'squat')).toBe(1)
    expect(nameScore('Pushup', 'Push-Up')).toBe(1)
    expect(nameScore('Push-Ups', 'Push Up')).toBe(1)
    expect(nameScore('Row Dumbbell', 'Dumbbell Row')).toBe(1)
    expect(nameScore('Dumbbell Bench Press', 'Bench Press')).toBeCloseTo(0.8)
    expect(nameScore('Bench Press', 'Leg Press')).toBe(0.5)
    expect(nameScore('', 'Squat')).toBe(0)
  })
  it('picks the exact row first, then the plain variant, and rejects weak matches', () => {
    const rows = [row('1', 'Incline Bench Press'), row('2', 'Bench Press'), row('3', 'Leg Press')]
    expect(pickBestMatch('bench press', rows)?.id).toBe('2')
    expect(pickBestMatch('Barbell Bench Press', [row('1', 'Incline Bench Press'), row('2', 'Bench Press')])?.id).toBe('2')
    expect(pickBestMatch('Overhead Press', [row('3', 'Leg Press')])).toBeNull()
    expect(pickBestMatch('Squat', [])).toBeNull()
  })
  it('prefers the caller’s custom row on a full tie', () => {
    expect(pickBestMatch('Goblet Squat', [row('a', 'Goblet Squat'), row('b', 'goblet squat', 'custom')])?.id).toBe('b')
  })
})

describe('applyMatches and programSummary', () => {
  const draft = {
    name: 'Full body',
    notes: 'Rest a day between sessions.',
    days: [
      { name: 'A', exercises: [ex('Bench Press', 4, 8, 120), ex('Unicorn Lift'), ex('Barbell Bench Press')] },
      { name: 'B', exercises: [ex('Unicorn Lift')] },
    ],
  }
  const matches = new Map<string, CatalogCandidate | null>([
    ['Bench Press', row('bp', 'Bench Press', 'wger', 'Bench press')],
    ['Barbell Bench Press', row('bp', 'Bench Press', 'wger', 'Bench press')],
    ['Unicorn Lift', null],
  ])

  it('drops unmatched exercises once, dedupes a row within a day and drops empty days', () => {
    const { program, unmatched } = applyMatches(draft, matches)
    expect(unmatched).toEqual(['Unicorn Lift'])
    expect(program.days).toEqual([
      { name: 'A', exercises: [{ exercise_id: 'bp', name_en: 'Bench Press', name_tr: 'Bench press', sets: 4, reps: 8, rest_sec: 120 }] },
    ])
  })
  it('summarises the program readably in the locale', () => {
    const { program, unmatched } = applyMatches(draft, matches)
    const tr = programSummary(program, unmatched, 'tr')
    expect(tr).toContain('**Full body**: 1 günlük program')
    expect(tr).toContain('- **A**: Bench press 4x8')
    expect(tr).toContain('atlananlar: Unicorn Lift')
    expect(programSummary(program, unmatched, 'en')).toContain('Skipped (not in the catalog): Unicorn Lift')
  })
  it('says so when nothing matched', () => {
    const { program, unmatched } = applyMatches(draft, new Map())
    expect(program.days).toEqual([])
    expect(programSummary(program, unmatched, 'en')).toMatch(/None of the suggested exercises/)
  })
})

describe('buildProgramPrompt', () => {
  it('fences the wish and carries the limits and the locale', () => {
    const p = buildProgramPrompt({ locale: 'tr', context: '{"x":1}', request: '3 gün, dambıl', now: new Date('2026-10-31T10:00:00Z') })
    expect(p).toContain('"""3 gün, dambıl"""')
    expect(p).toContain('in Turkish')
    expect(p).toContain('At most 6 days and 8 exercises per day')
    expect(p).toContain('CONTEXT: {"x":1}')
    expect(buildProgramPrompt({ locale: 'en', context: null, request: '', now: new Date() })).toContain('no specific wishes')
  })
})

describe('programTemplateName', () => {
  it('joins program and day and keeps within 80 characters', () => {
    expect(programTemplateName('Full body', 'Push')).toBe('Full body - Push')
    expect(programTemplateName(' Plan ', '')).toBe('Plan')
    const long = programTemplateName('P'.repeat(75), 'Day one')
    expect(long.length).toBe(80)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('programRequestOf', () => {
  const templates = [
    { ask: 'Bana bir antrenman programı öner.', askWith: `Bana bir antrenman programı öner: ${PROGRAM_SLOT}` },
    { ask: 'Suggest a workout program for me.', askWith: `Suggest a workout program for me: ${PROGRAM_SLOT}` },
  ]
  it('returns the wish of a program request in either language', () => {
    expect(programRequestOf('Bana bir antrenman programı öner: 3 gün, dambıl', templates)).toBe('3 gün, dambıl')
    expect(programRequestOf('Suggest a workout program for me: upper body ', templates)).toBe('upper body')
  })
  it('returns an empty wish for the plain request', () => {
    expect(programRequestOf('Suggest a workout program for me.', templates)).toBe('')
  })
  it('returns null for other messages and caps long wishes', () => {
    expect(programRequestOf('What should I train tomorrow?', templates)).toBeNull()
    expect(programRequestOf('Suggest a workout program for me: ', templates)).toBeNull()
    expect(programRequestOf(`Suggest a workout program for me: ${'x'.repeat(400)}`, templates)).toHaveLength(300)
  })
  it('handles a wish in the middle of a template', () => {
    expect(programRequestOf('Plan: legs please!', [{ ask: 'Plan.', askWith: `Plan: ${PROGRAM_SLOT}!` }])).toBe('legs please')
  })
})
