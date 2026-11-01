import { describe, expect, it } from 'vitest'
import { TOUR_STEPS, clampStep, isStandalone, shouldShowTour, stepFromScroll, tourSteps } from './logic'

const media = (standalone: boolean) => () => ({ matches: standalone })

describe('isStandalone', () => {
  it('detects the display-mode media query', () => {
    expect(isStandalone({ matchMedia: media(true) })).toBe(true)
    expect(isStandalone({ matchMedia: media(false) })).toBe(false)
  })
  it('detects iOS navigator.standalone', () => {
    expect(isStandalone({ matchMedia: media(false), navigator: { standalone: true } })).toBe(true)
  })
  it('is false without a window', () => {
    expect(isStandalone(undefined)).toBe(false)
    expect(isStandalone({})).toBe(false)
  })
})

describe('tourSteps', () => {
  it('ends with the install step in the browser', () => {
    const steps = tourSteps({ standalone: false })
    expect(steps).toEqual([...TOUR_STEPS])
    expect(steps.at(-1)).toBe('install')
  })
  it('hides the install step when running from the Home Screen', () => {
    const steps = tourSteps({ standalone: true })
    expect(steps).not.toContain('install')
    expect(steps).toHaveLength(TOUR_STEPS.length - 1)
    expect(steps[0]).toBe('welcome')
    expect(steps.at(-1)).toBe('privacy')
  })
})

describe('shouldShowTour', () => {
  it('shows only while tour_completed_at is empty', () => {
    expect(shouldShowTour({ tour_completed_at: null }, false)).toBe(true)
    expect(shouldShowTour({ tour_completed_at: '2026-11-01T10:00:00Z' }, false)).toBe(false)
  })
  it('stays hidden once dismissed in this session, even if the save failed', () => {
    expect(shouldShowTour({ tour_completed_at: null }, true)).toBe(false)
  })
  it('never shows without a settings row (loading or missing)', () => {
    expect(shouldShowTour(null, false)).toBe(false)
    expect(shouldShowTour(undefined, false)).toBe(false)
  })
})

describe('step index', () => {
  it('clamps to the deck', () => {
    expect(clampStep(-1, 7)).toBe(0)
    expect(clampStep(9, 7)).toBe(6)
    expect(clampStep(2.4, 7)).toBe(2)
    expect(clampStep(3, 0)).toBe(0)
  })
  it('maps a scroll position to the nearest step', () => {
    expect(stepFromScroll(0, 393, 7)).toBe(0)
    expect(stepFromScroll(393 * 2 + 150, 393, 7)).toBe(2)
    expect(stepFromScroll(393 * 2 + 250, 393, 7)).toBe(3)
    expect(stepFromScroll(99_999, 393, 7)).toBe(6)
    expect(stepFromScroll(100, 0, 7)).toBe(0)
  })
})
