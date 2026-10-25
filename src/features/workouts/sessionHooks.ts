import { useCallback, useEffect, useState } from 'react'
import { draftKey, emptyDraft, parseDraft, type SessionDraft } from './logic'

function readDraft(sessionId: string): SessionDraft {
  try {
    return parseDraft(window.localStorage.getItem(draftKey(sessionId)))
  } catch {
    return emptyDraft()
  }
}

/**
 * Live-session draft (current exercise, rest end timestamp, skipped ids) in localStorage, keyed by session.
 * A locked phone, a reload or an iOS PWA eviction resumes exactly where the user left off.
 */
export function useSessionDraft(sessionId: string) {
  const [draft, setDraft] = useState<SessionDraft>(() => readDraft(sessionId))

  const update = useCallback(
    (patch: Partial<SessionDraft> | ((d: SessionDraft) => Partial<SessionDraft>)) =>
      setDraft((prev) => {
        const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch), v: 1 as const }
        try {
          window.localStorage.setItem(draftKey(sessionId), JSON.stringify(next))
        } catch {
          // storage full / private mode: the session still works, it just will not survive a reload
        }
        return next
      }),
    [sessionId],
  )

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(draftKey(sessionId))
    } catch {
      /* ignore */
    }
  }, [sessionId])

  return { draft, update, clear }
}

/** Wall clock that ticks while `enabled` and re-syncs the moment the page becomes visible again. */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const tick = () => setNow(Date.now())
    const id = window.setInterval(tick, intervalMs)
    const onVisible = () => document.visibilityState === 'visible' && tick()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', tick)
    }
  }, [intervalMs, enabled])
  return now
}

type WakeLockSentinelLike = { release: () => Promise<void> }
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }

/** Best effort: keep the screen on during a session (Safari 16.4+, Chrome). Silently does nothing elsewhere. */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const nav = navigator as WakeLockNavigator
    if (!nav.wakeLock) return
    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false
    const acquire = async () => {
      try {
        const s = await nav.wakeLock!.request('screen')
        if (cancelled) void s.release()
        else sentinel = s
      } catch {
        /* denied or unsupported */
      }
    }
    const onVisible = () => document.visibilityState === 'visible' && void acquire()
    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release().catch(() => undefined)
    }
  }, [enabled])
}
