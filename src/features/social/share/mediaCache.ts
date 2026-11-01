// Signed URLs for the private social-media bucket. Requests made in the same tick are batched into one
// createSignedUrls call; URLs live in this module's memory only (never TanStack's persisted cache,
// IndexedDB or the service worker) and are refreshed before they expire.
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export const SOCIAL_BUCKET = 'social-media'
// Short-lived on purpose: access ends about 5 minutes after a block, unfollow, audience change or delete.
const TTL_SEC = 300
/** An entry is stale after 240 s, so a fresh URL is fetched before the old one expires. */
const REFRESH_MS = 240_000

const cache = new Map<string, { url: string; until: number }>()
let pending = new Map<string, ((url: string | null) => void)[]>()
let scheduled = false

async function flush() {
  scheduled = false
  const batch = pending
  pending = new Map()
  const paths = [...batch.keys()]
  try {
    const { data, error } = await supabase.storage.from(SOCIAL_BUCKET).createSignedUrls(paths, TTL_SEC)
    if (error) throw error
    const until = Date.now() + REFRESH_MS
    const byPath = new Map((data ?? []).map((d) => [d.path ?? '', d.signedUrl ?? null]))
    for (const [path, waiters] of batch) {
      const url = byPath.get(path) ?? null
      if (url) cache.set(path, { url, until })
      waiters.forEach((w) => w(url))
    }
  } catch {
    for (const waiters of batch.values()) waiters.forEach((w) => w(null))
  }
}

export function cachedSignedUrl(path: string): string | null {
  const hit = cache.get(path)
  return hit && hit.until > Date.now() ? hit.url : null
}

export function signedUrl(path: string): Promise<string | null> {
  const hit = cachedSignedUrl(path)
  if (hit) return Promise.resolve(hit)
  return new Promise((resolve) => {
    pending.set(path, [...(pending.get(path) ?? []), resolve])
    if (!scheduled) {
      scheduled = true
      setTimeout(() => void flush(), 0)
    }
  })
}

/** Forget everything (sign-out, leaving social). */
export function clearSignedUrls(): void {
  cache.clear()
}

/**
 * Signed URL for one object, re-signed every 240 s while mounted so a not-yet-loaded (lazy) image never
 * meets an expired token. `resolve` lets dev previews supply sample images.
 */
export function useSignedUrl(path: string, resolve?: (path: string) => string | null): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ path: string; url: string | null; failed: boolean }>(() => ({
    path,
    url: resolve ? resolve(path) : cachedSignedUrl(path),
    failed: false,
  }))
  useEffect(() => {
    if (resolve) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      void signedUrl(path).then((url) => {
        if (!alive) return
        setState({ path, url, failed: !url })
        if (url) timer = setTimeout(load, REFRESH_MS)
      })
    load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [path, resolve])
  if (state.path !== path) return { url: resolve ? resolve(path) : cachedSignedUrl(path), failed: false }
  return { url: state.url, failed: state.failed }
}

/**
 * Keeps the URL an <img> finished loading with, so a background re-sign does not download the image again;
 * an image that has not loaded yet always gets the newest URL.
 */
export function useStableSrc(url: string | null): { src: string | null; onLoad: () => void } {
  const [loaded, setLoaded] = useState<string | null>(null)
  return { src: loaded ?? url, onLoad: () => setLoaded((cur) => cur ?? url) }
}
