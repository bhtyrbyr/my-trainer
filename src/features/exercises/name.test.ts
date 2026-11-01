import { describe, expect, it } from 'vitest'
import { exerciseName, exerciseSteps, sanitizeSearch, vocabKey } from './name'

describe('exerciseName', () => {
  it('is always the capitalised English name, whatever the UI language', () => {
    expect(exerciseName({ name_en: 'barbell bench press' })).toBe('Barbell bench press')
    expect(exerciseName({ name_en: '  pull-up ' })).toBe('Pull-up')
  })
  it('ignores a Turkish name, also on custom rows', () => {
    const custom = { name_en: 'my cable fly', name_tr: 'Benim kablo fly' }
    expect(exerciseName(custom)).toBe('My cable fly')
  })
})

describe('exerciseSteps', () => {
  it('uses Turkish steps only when present', () => {
    expect(exerciseSteps({ instructions_en: ['a'], instructions_tr: null }, 'tr')).toEqual(['a'])
    expect(exerciseSteps({ instructions_en: ['a'], instructions_tr: ['b'] }, 'tr')).toEqual(['b'])
  })
})

describe('sanitizeSearch', () => {
  it('removes PostgREST control characters', () => {
    expect(sanitizeSearch(' bench,(press)% ')).toBe('bench press')
    expect(sanitizeSearch(undefined)).toBe('')
  })
})

describe('vocabKey', () => {
  it('turns catalog values into flat i18n keys', () => {
    expect(vocabKey('EZ bar')).toBe('ez_bar')
    expect(vocabKey('cardiovascular system')).toBe('cardiovascular_system')
    expect(vocabKey('  upper body ergometer ')).toBe('upper_body_ergometer')
    expect(vocabKey('wrist-flexors (left)')).toBe('wrist_flexors_left')
    expect(vocabKey('back')).toBe('back')
  })
  it('never yields dots, which i18next would read as nesting', () => {
    expect(vocabKey('a.b')).toBe('a_b')
    expect(vocabKey('çğü')).toBe('')
  })
})
