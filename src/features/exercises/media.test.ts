import { describe, expect, it } from 'vitest'
import { exerciseCredits, exerciseDbGifUrl, exerciseMedia, isMachineTranslated, thumbPath } from './media'
import type { ExerciseAttribution } from './types'

describe('exerciseMedia', () => {
  it('uses illustration frames, in order', () => {
    const ex = { media_frames: ['frames/squat/1.svg', 'frames/squat/2.svg'] }
    expect(exerciseMedia(ex)).toEqual({ kind: 'frames', paths: ['frames/squat/1.svg', 'frames/squat/2.svg'] })
    expect(thumbPath(ex)).toBe('frames/squat/1.svg')
  })

  it('falls back to nothing (the muscle map)', () => {
    expect(exerciseMedia({ media_frames: [] })).toEqual({ kind: 'none' })
    expect(exerciseMedia(undefined)).toEqual({ kind: 'none' })
    expect(thumbPath({ media_frames: [] })).toBeNull()
  })

  it('prefers the ExerciseDB GIF, then frames once the GIF failed', () => {
    const ex = { exercisedb_id: 'EIeI8Vf', media_frames: ['frames/squat/1.svg'] }
    expect(exerciseMedia(ex)).toEqual({ kind: 'gif', url: 'https://static.exercisedb.dev/media/EIeI8Vf.gif' })
    expect(exerciseMedia(ex, { gifFailed: true })).toEqual({ kind: 'frames', paths: ['frames/squat/1.svg'] })
    expect(exerciseMedia({ exercisedb_id: 'EIeI8Vf', media_frames: [] }, { gifFailed: true })).toEqual({ kind: 'none' })
    expect(exerciseMedia({ exercisedb_id: null, media_frames: [] })).toEqual({ kind: 'none' })
    expect(thumbPath(ex)).toBe('frames/squat/1.svg')
  })

  it('ignores empty frame entries and a missing column', () => {
    expect(exerciseMedia({ media_frames: ['', 'frames/a/1.svg'] })).toEqual({ kind: 'frames', paths: ['frames/a/1.svg'] })
    expect(exerciseMedia({} as never)).toEqual({ kind: 'none' })
  })
})

describe('exerciseDbGifUrl', () => {
  it('builds the hot-link URL for valid ids only', () => {
    expect(exerciseDbGifUrl('0001')).toBe('https://static.exercisedb.dev/media/0001.gif')
    expect(exerciseDbGifUrl(' ztAa1RK ')).toBe('https://static.exercisedb.dev/media/ztAa1RK.gif')
    expect(exerciseDbGifUrl(null)).toBeNull()
    expect(exerciseDbGifUrl('')).toBeNull()
    expect(exerciseDbGifUrl('abc')).toBeNull()
    expect(exerciseDbGifUrl('../../evil')).toBeNull()
    expect(exerciseDbGifUrl('a'.repeat(17))).toBeNull()
    expect(exerciseDbGifUrl('abcd.gif?x=1')).toBeNull()
  })
})

describe('exerciseCredits', () => {
  const full: ExerciseAttribution = {
    text: { author: 'wger contributors', license: 'CC BY-SA 4.0', url: 'https://wger.de/exercise/1' },
    media: { author: 'Bryl Lim / Everkinetic', license: 'CC BY-SA 4.0', url: 'https://github.com/bryllim/workout-guide' },
    changes: ['translated to Turkish (machine)'],
  }

  it('lists text, illustration and (for Turkish readers) the machine translation', () => {
    expect(exerciseCredits(full, 'tr').map((c) => c.role)).toEqual(['text', 'media', 'translation'])
    expect(exerciseCredits(full, 'en').map((c) => c.role)).toEqual(['text', 'media'])
    expect(exerciseCredits(full, 'en')[0]).toEqual({ role: 'text', author: 'wger contributors', license: 'CC BY-SA 4.0', url: 'https://wger.de/exercise/1' })
  })

  it('drops empty parts and non-http links', () => {
    const credits = exerciseCredits(
      { text: { author: '  ', license: null }, media: { author: 'Someone', license: 'CC0', url: 'javascript:alert(1)' } },
      'en',
    )
    expect(credits).toEqual([{ role: 'media', author: 'Someone', license: 'CC0', url: null }])
  })

  it('is empty for custom and legacy rows', () => {
    expect(exerciseCredits(null, 'tr')).toEqual([])
    expect(exerciseCredits({}, 'tr')).toEqual([])
  })

  it('detects the machine-translation marker only', () => {
    expect(isMachineTranslated({ changes: ['translated to Turkish (machine)'] })).toBe(true)
    expect(isMachineTranslated({ changes: ['Turkish name curated'] })).toBe(false)
    expect(isMachineTranslated(null)).toBe(false)
  })
})
