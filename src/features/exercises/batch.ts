/**
 * Collects single-key lookups made within `wait` ms into one call of `run` (e.g. thirty thumbnails
 * mounting together become one createSignedUrls request). Keys missing from the result resolve to null;
 * a failed run rejects every caller of that batch.
 */
export function createBatcher<V>(run: (keys: string[]) => Promise<Record<string, V>>, wait = 10) {
  let pending: Map<string, { resolve: (v: V | null) => void; reject: (e: unknown) => void }[]> | null = null

  const flush = async () => {
    const batch = pending
    pending = null
    if (!batch) return
    try {
      const result = await run([...batch.keys()])
      for (const [key, waiters] of batch) for (const w of waiters) w.resolve(result[key] ?? null)
    } catch (e) {
      for (const waiters of batch.values()) for (const w of waiters) w.reject(e)
    }
  }

  return (key: string): Promise<V | null> =>
    new Promise((resolve, reject) => {
      if (!pending) {
        pending = new Map()
        setTimeout(() => void flush(), wait)
      }
      const waiters = pending.get(key) ?? []
      waiters.push({ resolve, reject })
      pending.set(key, waiters)
    })
}
