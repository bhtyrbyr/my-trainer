import { useTranslation } from 'react-i18next'
import { Bell, BellOff, Loader2 } from 'lucide-react'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { cn } from '@/lib/utils'
import { usePushState, useTogglePush } from './hooks'

/** Settings > Notifications: reminders on/off for this device, with the reason when it cannot be on. */
export function NotificationsSection() {
  const { t } = useTranslation('today')
  const state = usePushState()
  const toggle = useTogglePush()
  const s = state.data
  if (!s?.configured) return null

  const blocked = s.support !== 'ok' || s.permission === 'denied'
  const hint =
    s.support === 'needs-install'
      ? t('notify.needsInstall')
      : s.support === 'unsupported'
        ? t('notify.unsupported')
        : s.permission === 'denied'
          ? t('notify.denied')
          : s.enabled
            ? t('notify.onHint')
            : t('notify.offHint')

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{t('notify.section')}</h2>
      <button
        type="button"
        role="switch"
        aria-checked={s.enabled}
        disabled={blocked || toggle.isPending}
        onClick={() => toggle.mutate(!s.enabled)}
        className="hairline flex w-full items-center gap-3 rounded-xl bg-surface px-4 py-3.5 text-left transition-colors hover:bg-raised disabled:hover:bg-surface"
      >
        {s.enabled ? <Bell className="size-5 text-volt" aria-hidden /> : <BellOff className="size-5 text-ink-muted" aria-hidden />}
        <span className="flex-1">
          <span className="block text-[15px]">{t('notify.device')}</span>
          <span className="block text-[12px] leading-snug text-ink-faint">{hint}</span>
        </span>
        {toggle.isPending ? (
          <Loader2 className="size-5 animate-spin text-ink-muted" aria-hidden />
        ) : (
          <span className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors', s.enabled ? 'bg-volt' : 'bg-raised', blocked && 'opacity-40')} aria-hidden>
            <span className={cn('absolute top-0.5 size-6 rounded-full bg-ink transition-transform', s.enabled ? 'translate-x-[22px] bg-volt-ink' : 'translate-x-0.5')} />
          </span>
        )}
      </button>
      <ErrorNote error={toggle.error} />
    </section>
  )
}
