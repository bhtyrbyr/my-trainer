import { describe, expect, it } from 'vitest'
import { cropViewBox, glyphBand } from './crop'

describe('glyphBand', () => {
  it('follows the target muscles', () => {
    expect(glyphBand(['chest'], ['triceps', 'deltoids'])).toBe('upper')
    expect(glyphBand(['hamstring'], ['calves', 'gluteal'])).toBe('lower')
    expect(glyphBand(['gluteal'], ['lower-back'])).toBe('lower')
  })

  it('falls back to secondary muscles, and to the whole body when mixed or empty', () => {
    expect(glyphBand([], ['biceps'])).toBe('upper')
    expect(glyphBand(['quadriceps', 'abs'], [])).toBe('full')
    expect(glyphBand([], [])).toBe('full')
  })
})

describe('cropViewBox', () => {
  it('keeps the width and cuts the height to the band', () => {
    expect(cropViewBox('42 90 643 1267', 'upper')).toBe('42 90 643 710')
    expect(cropViewBox('42 90 643 1267', 'lower')).toBe('42 622 643 735')
    expect(cropViewBox('42 90 643 1267', 'full')).toBe('42 90 643 1267')
  })

  it('leaves an unreadable viewBox alone', () => {
    expect(cropViewBox('nope', 'upper')).toBe('nope')
  })
})
