// On-device image preparation for sharing. Drawing through a canvas strips EXIF (location, device) by
// construction; nothing here touches storage, IndexedDB or the service worker (CLAUDE.md rule 5).
import { loadImage } from '@/lib/image'
import { ENCODE_ATTEMPTS, compareLayout, fitWithin, fitsLimit } from './imageSize'
import type { PreparedImage } from './types'

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('ENCODE_FAILED'))), 'image/jpeg', quality)
  })
}

function draw(source: CanvasImageSource, sw: number, sh: number, maxEdge: number): HTMLCanvasElement {
  const { width, height } = fitWithin(sw, sh, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('CANVAS_UNSUPPORTED')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  return canvas
}

/** Downscale to <= 1280 px, JPEG q0.8, stepping down until the file is under the 600 KB bucket limit. */
export async function prepareImage(src: Blob | HTMLCanvasElement): Promise<PreparedImage> {
  const img = src instanceof HTMLCanvasElement ? src : await loadImage(src)
  const sw = img instanceof HTMLCanvasElement ? img.width : img.naturalWidth
  const sh = img instanceof HTMLCanvasElement ? img.height : img.naturalHeight
  for (const step of ENCODE_ATTEMPTS) {
    const canvas = draw(img, sw, sh, step.maxEdge)
    const blob = await encode(canvas, step.quality)
    if (fitsLimit(blob.size)) return { blob, width: canvas.width, height: canvas.height }
  }
  throw new Error('IMAGE_TOO_LARGE')
}

/** Before/after composite with the two dates under the panels, rendered on a canvas in memory. */
export async function renderCompare(before: Blob, after: Blob, labels: [string, string]): Promise<PreparedImage> {
  const [a, b] = await Promise.all([loadImage(before), loadImage(after)])
  const L = compareLayout({ width: a.naturalWidth, height: a.naturalHeight }, { width: b.naturalWidth, height: b.naturalHeight })
  const canvas = document.createElement('canvas')
  canvas.width = L.width
  canvas.height = L.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('CANVAS_UNSUPPORTED')
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#121410'
  ctx.fillRect(0, 0, L.width, L.height)
  ctx.drawImage(a, L.left.x, L.left.y, L.left.w, L.left.h)
  ctx.drawImage(b, L.right.x, L.right.y, L.right.w, L.right.h)
  ctx.fillStyle = '#eef0ea'
  ctx.font = `600 ${L.fontPx}px Inter, system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  const y = L.band.y + L.band.h / 2
  ctx.fillText(labels[0], L.left.x + L.left.w / 2, y)
  ctx.fillText(labels[1], L.right.x + L.right.w / 2, y)
  return prepareImage(canvas)
}
