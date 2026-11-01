import { describe, expect, it } from 'vitest'
import { MAX_TAGS, normalizeTag, splitHashtags } from './hashtags'

const tags = (s: string) => splitHashtags(s).flatMap((x) => (x.type === 'tag' ? [x.tag] : []))

describe('normalizeTag', () => {
  it('lowercases the Turkish way', () => {
    expect(normalizeTag('İstanbul')).toBe('istanbul')
    expect(normalizeTag('IŞIK')).toBe('ışık')
    expect(normalizeTag('ÇĞÖŞÜ')).toBe('çğöşü')
    expect(normalizeTag('LegDay')).toBe('legday')
  })
  it('drops a leading #', () => {
    expect(normalizeTag('#Bacak')).toBe('bacak')
  })
})

describe('splitHashtags', () => {
  it('keeps the text intact around tags', () => {
    const s = 'Bugün #bacakGünü bitti, #PR geldi!'
    const parts = splitHashtags(s)
    expect(parts.map((p) => p.text).join('')).toBe(s)
    expect(parts).toEqual([
      { type: 'text', text: 'Bugün ' },
      { type: 'tag', text: '#bacakGünü', tag: 'bacakgünü' },
      { type: 'text', text: ' bitti, ' },
      { type: 'tag', text: '#PR', tag: 'pr' },
      { type: 'text', text: ' geldi!' },
    ])
  })

  it('finds tags at the start, end and next to punctuation', () => {
    expect(tags('#deadlift')).toEqual(['deadlift'])
    expect(tags('(#squat) #bench.')).toEqual(['squat', 'bench'])
    expect(tags('line\n#yeni_rekor')).toEqual(['yeni_rekor'])
  })

  it('needs 2..30 characters and no longer run', () => {
    expect(tags('#a #ab')).toEqual(['ab'])
    expect(tags(`#${'x'.repeat(30)}`)).toEqual(['x'.repeat(30)])
    expect(tags(`#${'x'.repeat(31)}`)).toEqual([])
  })

  it('ignores tags glued to a word, entities and pure numbers', () => {
    expect(tags('mail#tag')).toEqual([])
    expect(tags('ç#tag')).toEqual([])
    expect(tags('&#123; ok')).toEqual([])
    expect(tags('#2024 #5x5 #100kg')).toEqual(['5x5', '100kg'])
  })

  it('stops at characters outside the set', () => {
    expect(tags('#koşu-bandı')).toEqual(['koşu'])
    expect(tags('#ab#cd')).toEqual(['ab'])
    expect(tags('##double')).toEqual(['double'])
  })

  it('handles Turkish capitals', () => {
    expect(tags('#İzmirKoşusu #IŞIL')).toEqual(['izmirkoşusu', 'ışıl'])
  })

  it('links only the first 10 distinct tags, like the database stores them', () => {
    expect(MAX_TAGS).toBe(10)
    const words = Array.from({ length: 12 }, (_, i) => `#t${String.fromCharCode(97 + i)}`)
    // #TA repeats the first tag (same normalised form) after the cap: still a tag
    const s = `${words.join(' ')} #TA`
    const parts = splitHashtags(s)
    expect(parts.map((p) => p.text).join('')).toBe(s)
    expect(tags(s)).toEqual(['ta', 'tb', 'tc', 'td', 'te', 'tf', 'tg', 'th', 'ti', 'tj', 'ta'])
    expect(parts.at(-2)).toEqual({ type: 'text', text: ' #tk #tl ' })
  })

  it('returns an empty list for empty text', () => {
    expect(splitHashtags('')).toEqual([])
    expect(splitHashtags('no tags')).toEqual([{ type: 'text', text: 'no tags' }])
  })
})
