import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { IsRestoringProvider, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { persistQueryClientRestore, persistQueryClientSubscribe } from '@tanstack/react-query-persist-client'
import { useAuth } from '@/features/auth/AuthProvider'
import { createIdbPersister, persistGeneration } from '@/lib/offline/persister'
import { dehydrateOptions } from '@/lib/offline/policy'
import { isQueuedMutation, queuedMutations, type QueueMeta } from '@/lib/offline/queue'

/** Persisted cache and queue live this long; older records are dropped on start. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** Confirmed writes stay in the mutation cache this long (screens may still read their result), then go. */
const PRUNE_AFTER_MS = 60_000
/** Refreshed after any queued write that moved points (triggers): same set the online hooks refreshed. */
const POINTS_KEYS: QueryKey[] = [['leaderboard'], ['dashboard'], ['badges']]

/**
 * Restores the signed-in user's persisted query cache and offline queue from IndexedDB, keeps persisting
 * it, and resumes queued writes. Queries wait while restoring (IsRestoringProvider). Owner-scoped: a
 * different account never sees the record; sign-out / account switch clear it (clearUserData) and bump
 * the generation, which restarts this gate with a fresh persister.
 */
export function OfflinePersistence({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const owner = user?.id ?? null
  const generation = useSyncExternalStore(persistGeneration.subscribe, persistGeneration.get, persistGeneration.get)
  const token = owner ? `${owner}:${generation}` : null
  const [restored, setRestored] = useState<string | null>(null)

  useEffect(() => {
    if (!owner) return
    const current = `${owner}:${generation}`
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    const persister = createIdbPersister(owner, __APP_VERSION__)
    const options = { queryClient: qc, persister, maxAge: MAX_AGE_MS, buster: '', dehydrateOptions }

    void persistQueryClientRestore(options)
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return
        unsubscribe = persistQueryClientSubscribe(options)
        // the restored copy is for showing something at once and offline; online, every page refetches
        // on mount instead of trusting it for staleTime (a reload right after a change showed old data)
        void qc.invalidateQueries({ refetchType: 'none' })
        setRestored(current)
        // writes queued in an earlier visit: replay now (they pause again right away when offline)
        void qc.resumePausedMutations()
      })

    const flush = () => void persister.flush()
    const onVisibility = () => document.visibilityState === 'hidden' && flush()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      cancelled = true
      unsubscribe?.()
      flush()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
    }
  }, [qc, owner, generation])

  return <IsRestoringProvider value={token !== null && restored !== token}>{children}</IsRestoringProvider>
}

/**
 * Watches the offline queue. When it drains (nothing pending any more) the screens touched by the
 * replayed writes refetch, and points-moving writes also refresh the profile, leaderboard, dashboard and
 * badges, exactly once per drain instead of once per write. Confirmed writes are pruned after a while.
 */
export function QueueDrainWatcher() {
  const qc = useQueryClient()
  const { refreshProfile } = useAuth()
  const refresh = useRef(refreshProfile)
  useEffect(() => {
    refresh.current = refreshProfile
  }, [refreshProfile])

  useEffect(() => {
    const cache = qc.getMutationCache()
    const touched = new Map<string, QueryKey>()
    let points = false
    const timers = new Set<number>()

    const unsubscribe = cache.subscribe((event) => {
      if (event.type !== 'updated' || !isQueuedMutation(event.mutation)) return
      const { mutation, action } = event
      if (action.type === 'success') {
        const meta = (mutation.options.meta ?? {}) as QueueMeta
        for (const key of meta.invalidates ?? []) touched.set(JSON.stringify(key), key)
        if (meta.points) points = true
        const id = window.setTimeout(() => {
          timers.delete(id)
          if (mutation.state.status === 'success') cache.remove(mutation)
        }, PRUNE_AFTER_MS)
        timers.add(id)
      }
      if (action.type !== 'success' && action.type !== 'error') return
      if (queuedMutations(qc).some((m) => m.state.status === 'pending')) return
      const keys = [...touched.values(), ...(points ? POINTS_KEYS : [])]
      const moved = points
      touched.clear()
      points = false
      for (const queryKey of keys) void qc.invalidateQueries({ queryKey })
      if (moved) void refresh.current()
    })
    return () => {
      unsubscribe()
      timers.forEach((id) => window.clearTimeout(id))
    }
  }, [qc])

  return null
}
