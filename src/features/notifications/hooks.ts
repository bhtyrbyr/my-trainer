import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { VAPID_PUBLIC_KEY, currentSubscription, disablePush, enablePush, pushSupport } from './push'

export const pushKeys = { device: ['push', 'device'] as const }

export type PushState = {
  configured: boolean
  support: ReturnType<typeof pushSupport>
  permission: NotificationPermission | 'unsupported'
  enabled: boolean
}

/** This device's reminder state (not the account's: every device subscribes on its own). */
export function usePushState() {
  return useQuery({
    queryKey: pushKeys.device,
    queryFn: async (): Promise<PushState> => {
      const support = pushSupport()
      const permission = 'Notification' in window ? Notification.permission : 'unsupported'
      const enabled = support === 'ok' && permission === 'granted' && Boolean(await currentSubscription())
      return { configured: Boolean(VAPID_PUBLIC_KEY), support, permission, enabled }
    },
    staleTime: 60_000,
  })
}

export function useTogglePush() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (on: boolean) => (on ? enablePush() : disablePush()),
    onSettled: () => qc.invalidateQueries({ queryKey: pushKeys.device }),
  })
}
