/**
 * Client-side image processing. Drawing through a canvas strips EXIF (GPS, device) by construction.
 */

export async function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src)
  try {
    const img = new Image()
    if (typeof src === 'string') img.crossOrigin = 'anonymous'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'))
      img.src = url
    })
    return img
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url)
  }
}

/** Center-crop to a square and resize. Returns a JPEG blob. */
export async function toSquareJpeg(src: Blob | string, size = 512, quality = 0.86): Promise<Blob> {
  const img = await loadImage(src)
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const sx = (img.naturalWidth - side) / 2
  const sy = (img.naturalHeight - side) / 2

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('CANVAS_UNSUPPORTED')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('ENCODE_FAILED'))), 'image/jpeg', quality)
  })
}

/** Downscale so the longest edge is <= maxEdge. Keeps aspect ratio. Returns JPEG. */
export async function downscaleJpeg(src: Blob, maxEdge = 1600, quality = 0.85): Promise<Blob> {
  const img = await loadImage(src)
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.round(img.naturalWidth * scale)
  const h = Math.round(img.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('CANVAS_UNSUPPORTED')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('ENCODE_FAILED'))), 'image/jpeg', quality)
  })
}
