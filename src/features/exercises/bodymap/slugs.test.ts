import { describe, expect, it } from 'vitest'
import { resolveBodyHighlight, slugsForTerm } from './slugs'
import { BODY_SLUGS, type BodyFigures } from './types'
import { MALE } from './male'
import { FEMALE } from './female'

// Every muscle term the catalog sync writes (vocab.test.ts) plus ExerciseDB-style short forms.
const CATALOG_TERMS = [
  'abdominals', 'abductors', 'adductors', 'ankle stabilizers', 'ankles', 'back', 'biceps', 'brachialis', 'calves',
  'cardiovascular system', 'core', 'deltoids', 'erector spinae', 'feet', 'forearms', 'glutes', 'grip muscles',
  'hamstrings', 'hands', 'hip flexors', 'latissimus dorsi', 'levator scapulae', 'obliques', 'pectorals', 'quadriceps',
  'rear deltoids', 'rhomboids', 'rotator cuff', 'serratus anterior', 'soleus', 'sternocleidomastoid',
  'tibialis anterior', 'trapezius', 'triceps', 'upper back', 'wrist extensors', 'wrist flexors', 'wrists',
]
const EXERCISEDB_TERMS = [
  'pectorals', 'quads', 'glutes', 'hamstrings', 'lats', 'delts', 'triceps', 'biceps', 'abs', 'calves', 'traps',
  'upper back', 'spine', 'forearms', 'adductors', 'abductors', 'serratus anterior', 'cardiovascular system', 'levator scapulae',
]
const TEXT_ONLY = ['ankle stabilizers', 'ankles', 'cardiovascular system', 'feet', 'hands', 'rotator cuff', 'wrists']
const ALL_TERMS = [...CATALOG_TERMS, ...EXERCISEDB_TERMS]

describe('slugsForTerm', () => {
  it('maps the ExerciseDB-style terms', () => {
    expect(slugsForTerm('pectorals')).toEqual(['chest'])
    expect(slugsForTerm('quads')).toEqual(['quadriceps'])
    expect(slugsForTerm('glutes')).toEqual(['gluteal'])
    expect(slugsForTerm('hamstrings')).toEqual(['hamstring'])
    expect(slugsForTerm('lats')).toEqual(['upper-back'])
    expect(slugsForTerm('delts')).toEqual(['deltoids'])
    expect(slugsForTerm('triceps')).toEqual(['triceps'])
    expect(slugsForTerm('biceps')).toEqual(['biceps'])
    expect(slugsForTerm('abs')).toEqual(['abs'])
    expect(slugsForTerm('calves')).toEqual(['calves'])
    expect(slugsForTerm('traps')).toEqual(['trapezius'])
    expect(slugsForTerm('upper back')).toEqual(['upper-back'])
    expect(slugsForTerm('spine')).toEqual(['lower-back'])
    expect(slugsForTerm('forearms')).toEqual(['forearm'])
    expect(slugsForTerm('adductors')).toEqual(['adductors'])
    expect(slugsForTerm('abductors')).toEqual(['gluteal'])
    expect(slugsForTerm('serratus anterior')).toEqual(['obliques'])
    expect(slugsForTerm('levator scapulae')).toEqual(['trapezius'])
    expect(slugsForTerm('cardiovascular system')).toEqual([])
  })

  it('maps the remaining catalog terms', () => {
    expect(slugsForTerm('erector spinae')).toEqual(['lower-back'])
    expect(slugsForTerm('tibialis anterior')).toEqual(['tibialis'])
    expect(slugsForTerm('sternocleidomastoid')).toEqual(['neck'])
    expect(slugsForTerm('core')).toEqual(['abs', 'obliques'])
    expect(slugsForTerm('back')).toEqual(['upper-back', 'lower-back'])
  })

  it('is case and whitespace insensitive', () => {
    expect(slugsForTerm('  Upper Back ')).toEqual(['upper-back'])
    expect(slugsForTerm('PECTORALS')).toEqual(['chest'])
  })

  it('maps every term except the ones with no shape on the figure', () => {
    for (const term of ALL_TERMS) expect(slugsForTerm(term).length > 0, term).toBe(!TEXT_ONLY.includes(term))
  })

  it('only yields known body-highlighter parts, all drawn on both figures', () => {
    const known = new Set<string>(BODY_SLUGS)
    const drawn = (f: BodyFigures) => new Set([...f.front.parts, ...f.back.parts].map((p) => p.slug))
    for (const fig of [MALE, FEMALE]) {
      const parts = drawn(fig)
      for (const term of ALL_TERMS)
        for (const s of slugsForTerm(term)) {
          expect(known.has(s), s).toBe(true)
          expect(parts.has(s), s).toBe(true)
        }
    }
  })
})

describe('resolveBodyHighlight', () => {
  it('splits target and secondary parts and never repeats a target as secondary', () => {
    expect(resolveBodyHighlight(['pectorals'], ['triceps', 'delts', 'chest'])).toEqual({
      target: ['chest'],
      secondary: ['triceps', 'deltoids'],
      unmapped: [],
    })
  })

  it('lists unmappable terms once, in first-seen order, keeping their spelling', () => {
    const r = resolveBodyHighlight(['cardiovascular system', 'quads'], ['Rotator cuff', 'cardiovascular system', 'calves'])
    expect(r.target).toEqual(['quadriceps'])
    expect(r.secondary).toEqual(['calves'])
    expect(r.unmapped).toEqual(['cardiovascular system', 'Rotator cuff'])
  })

  it('lights several parts for broad terms', () => {
    const r = resolveBodyHighlight(['back'], ['core'])
    expect(r.target).toEqual(['upper-back', 'lower-back'])
    expect(r.secondary).toEqual(['abs', 'obliques'])
  })

  it('handles empty input', () => {
    expect(resolveBodyHighlight([], [])).toEqual({ target: [], secondary: [], unmapped: [] })
  })
})

describe('figure data', () => {
  it('has cropped viewBoxes of one size per sex (front and back render at the same scale)', () => {
    for (const fig of [MALE, FEMALE]) {
      const [, , fw, fh] = fig.front.viewBox.split(' ').map(Number)
      const [, , bw, bh] = fig.back.viewBox.split(' ').map(Number)
      expect([fw, fh]).toEqual([bw, bh])
      expect(fw).toBeLessThan(724)
      expect(fig.front.outline.length).toBeGreaterThan(100)
    }
  })
})
