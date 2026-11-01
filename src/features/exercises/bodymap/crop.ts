import type { BodySlug } from './types'

export type BodyBand = 'upper' | 'lower' | 'full'

const UPPER: ReadonlySet<BodySlug> = new Set([
  'chest', 'obliques', 'abs', 'biceps', 'triceps', 'forearm', 'deltoids', 'trapezius', 'upper-back', 'lower-back', 'neck',
])
const LOWER: ReadonlySet<BodySlug> = new Set(['gluteal', 'quadriceps', 'hamstring', 'adductors', 'abductors', 'calves', 'tibialis'])

/**
 * Which half of the figure a small glyph should show: the band all highlighted parts sit in, decided by
 * the target muscles first (secondary ones only when nothing is targeted). Mixed or none: the whole body.
 */
export function glyphBand(target: BodySlug[], secondary: BodySlug[]): BodyBand {
  const lead = target.length ? target : secondary
  if (!lead.length) return 'full'
  if (lead.every((s) => UPPER.has(s))) return 'upper'
  if (lead.every((s) => LOWER.has(s))) return 'lower'
  return 'full'
}

/** Fractions of the cropped figure height each band keeps (head to mid-thigh, hips to feet). */
const BANDS: Record<Exclude<BodyBand, 'full'>, [number, number]> = { upper: [0, 0.56], lower: [0.42, 1] }

/** The figure's viewBox reduced to one band (same width, so the figure scales up in a square thumbnail). */
export function cropViewBox(viewBox: string, band: BodyBand): string {
  if (band === 'full') return viewBox
  const [x, y, w, h] = viewBox.split(/[\s,]+/).map(Number)
  if (![x, y, w, h].every(Number.isFinite)) return viewBox
  const [from, to] = BANDS[band]
  return [x, Math.round(y + h * from), w, Math.round(h * (to - from))].join(' ')
}
