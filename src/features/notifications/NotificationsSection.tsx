import { useTranslation } from 'react-i18next'
import { Bell, BellOff, Loader2 } from 'lucide-react'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { GroupedList, ListRow } from '@/components/ui/GroupedList'
import { Switch } from '@/components/ui/Switch'
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
    <>
      <GroupedList title={t('notify.section')}>
        <ListRow
          icon={s.enabled ? Bell : BellOff}
          label={t('notify.device')}
          hint={hint}
          trailing={
            toggle.isPending ? (
              <span className="flex h-11 w-[60px] items-center justify-center">
                <Loader2 className="size-5 animate-spin text-ink-muted" aria-hidden />
              </span>
            ) : (
              <Switch checked={s.enabled} disabled={blocked} label={t('notify.device')} onChange={(next) => toggle.mutate(next)} />
            )
          }
          className="py-1.5"
        />
      </GroupedList>
      <ErrorNote error={toggle.error} />
    </>
  )
}
