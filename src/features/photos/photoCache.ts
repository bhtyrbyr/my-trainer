/**
 * In-memory object URLs of decrypted images, so thumbnails are not downloaded and decrypted again
 * while the vault stays unlocked. Only blob: URLs in this tab's memory; cleared (and revoked) on lock,
 * sign-out and page unload. Nothing is written to disk.
 */
const urls = new Map<string, string>()
// bumped on every clear, so a decryption that finishes after a lock is not cached
let generation = 0

export function cacheGeneration(): number {
  return generation
}

export function cachedUrl(id: string): string | undefined {
  return urls.get(id)
}

export function cacheUrl(id: string, blob: Blob, gen: number): string | null {
  if (gen !== generation) return null
  const existing = urls.get(id)
  if (existing) return existing
  const url = URL.createObjectURL(blob)
  urls.set(id, url)
  return url
}

export function dropUrl(id: string): void {
  const url = urls.get(id)
  if (url) URL.revokeObjectURL(url)
  urls.delete(id)
}

export function clearPhotoCache(): void {
  generation += 1
  for (const url of urls.values()) URL.revokeObjectURL(url)
  urls.clear()
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', clearPhotoCache)
