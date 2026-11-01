// Pure sizing rules for shared images (docs/social-spec.md section 1: <= 1280 px long edge, JPEG ~q0.8,
// bucket limit 600 KB, at most 4 per post).
export const MAX_EDGE = 1280
export const MAX_BYTES = 600 * 1024
export const MAX_IMAGES = 4
export const START_QUALITY = 0.8

/** Scale (never up) so the longest edge is <= maxEdge; at least 1 px each side. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const scale = Math.min(1, maxEdge / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

/**
 * Encode attempts in order until one fits under MAX_BYTES: quality steps first, then smaller edges.
 * The last attempt (720 px, q0.6) is far under the limit for any JPEG.
 */
export const ENCODE_ATTEMPTS: readonly { maxEdge: number; quality: number }[] = [
  { maxEdge: MAX_EDGE, quality: START_QUALITY },
  { maxEdge: MAX_EDGE, quality: 0.7 },
  { maxEdge: MAX_EDGE, quality: 0.6 },
  { maxEdge: 1024, quality: 0.65 },
  { maxEdge: 720, quality: 0.6 },
]

export function fitsLimit(bytes: number): boolean {
  return bytes > 0 && bytes <= MAX_BYTES
}

/** How many more images a post may take. */
export function remainingSlots(current: number, max = MAX_IMAGES): number {
  return Math.max(0, max - current)
}

/**
 * Side-by-side compare composite: two panels of equal height (the shorter source sets it), each keeping
 * its aspect ratio, a gutter between them and a caption band under them for the dates; scaled to maxEdge.
 */
export function compareLayout(a: { width: number; height: number }, b: { width: number; height: number }, maxEdge = MAX_EDGE) {
  const gutter = 8
  const panelH = Math.max(1, Math.min(a.height, b.height))
  const band = Math.max(48, Math.round(panelH * 0.1))
  const aw = Math.max(1, Math.round((a.width / a.height) * panelH))
  const bw = Math.max(1, Math.round((b.width / b.height) * panelH))
  const fullW = aw + gutter + bw
  const fullH = panelH + band
  const scale = Math.min(1, maxEdge / Math.max(fullW, fullH))
  const s = (n: number) => Math.round(n * scale)
  const width = s(fullW)
  const height = s(fullH)
  const rightX = s(aw + gutter)
  return {
    width,
    height,
    left: { x: 0, y: 0, w: s(aw), h: s(panelH) },
    right: { x: rightX, y: 0, w: width - rightX, h: s(panelH) },
    band: { y: s(panelH), h: height - s(panelH) },
    fontPx: Math.max(12, Math.round(band * scale * 0.42)),
  }
}
