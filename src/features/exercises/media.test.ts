import { describe, expect, it } from 'vitest'
import { exerciseCredits, exerciseMedia, isMachineTranslated, thumbPath } from './media'
import type { ExerciseAttribution } from './types'

describe('exerciseMedia', () => {
  it('prefers illustration frames, in order', () => {
    const ex = { media_frames: ['frames/squat/1.svg', 'frames/squat/2.svg'], gif_path: 'gifs/x.gif' }
    expect(exerciseMedia(ex)).toEqual({ kind: 'frames', paths: ['frames/squat/1.svg', 'frames/squat/2.svg'] })
    expect(thumbPath(ex)).toBe('frames/squat/1.svg')
  })

  it('falls back to a legacy GIF, then to nothing', () => {
    expect(exerciseMedia({ media_frames: [], gif_path: 'gifs/x.gif' })).toEqual({ kind: 'gif', path: 'gifs/x.gif' })
    expect(exerciseMedia({ media_frames: [], gif_path: null })).toEqual({ kind: 'none' })
    expect(exerciseMedia(undefined)).toEqual({ kind: 'none' })
    expect(thumbPath({ media_frames: [], gif_path: null })).toBeNull()
  })

  it('ignores empty frame entries and a missing column (old rows before the migration)', () => {
    expect(exerciseMedia({ media_frames: ['', 'frames/a/1.svg'], gif_path: null })).toEqual({ kind: 'frames', paths: ['frames/a/1.svg'] })
    expect(exerciseMedia({ gif_path: null } as never)).toEqual({ kind: 'none' })
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
