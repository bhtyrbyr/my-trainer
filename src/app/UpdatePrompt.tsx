import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

const CHECK_INTERVAL_MS = 60_000 // active sessions look for a new deploy every minute
const AUTO_RELOAD_SECONDS = 15

/**
 * Deploy-aware update banner. When CI/CD ships a new version, the waiting service worker triggers
 * `needRefresh`; we warn the user, count down, then activate the new worker and reload. Avoids the
 * silent reload (black screen) of registerType 'autoUpdate'.
 */
export function UpdatePrompt({ forceVisible = false }: { forceVisible?: boolean }) {
  const { t } = useTranslation('common')
  const [seconds, setSeconds] = useState(AUTO_RELOAD_SECONDS)
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      window.setInterval(() => {
        if (navigator.onLine) void registration.update()
      }, CHECK_INTERVAL_MS)
    },
  })

  const visible = needRefresh || forceVisible

  useEffect(() => {
    if (!visible) return
    setSeconds(AUTO_RELOAD_SECONDS)
    const id = window.setInterval(() => setSeconds((s) => s - 1), 1000)
    return () => window.clearInterval(id)
  }, [visible])

  useEffect(() => {
    if (visible && seconds <= 0 && !forceVisible) void updateServiceWorker(true)
  }, [visible, seconds, forceVisible, updateServiceWorker])

  // Safety net: a chunk that no longer exists after a deploy -> reload once.
  useEffect(() => {
    const onError = (e: Event) => {
      const msg = String((e as ErrorEvent).message ?? (e as PromiseRejectionEvent).reason ?? '')
      if (/Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk/i.test(msg)) {
        const key = 'mt.chunkReload'
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1')
          window.location.reload()
        }
      }
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onError)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onError)
    }
  }, [])

  if (!visible) return null

  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 bottom-0 z-[60] px-4 pb-safe">
      <div className="hairline rise-in mx-auto mb-[calc(var(--nav-h)+0.75rem)] max-w-md space-y-3 rounded-[var(--radius-card)] bg-raised/95 p-4 shadow-[0_8px_32px_oklch(0%_0_0/45%)] backdrop-blur lg:mb-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-volt/15 text-volt">
            <RefreshCw className="size-5 animate-[spin_3s_linear_infinite]" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-tight">{t('update.title')}</p>
            <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">{t('update.body', { n: Math.max(seconds, 0) })}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="md" className="px-4" onClick={() => setNeedRefresh(false)}>
            {t('update.later')}
          </Button>
          <Button size="md" className="flex-1" onClick={() => void updateServiceWorker(true)}>
            {t('update.now')}
          </Button>
        </div>
      </div>
    </div>
  )
}
