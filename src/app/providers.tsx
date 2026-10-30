import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { registerSleepWaterQueue } from '@/features/sleepwater/hooks'
import { registerTodayQueue } from '@/features/today/hooks'
import { registerWorkoutQueue } from '@/features/workouts/hooks'
import { OfflineChip, SyncSheet } from '@/lib/offline/OfflineStatus'
import { OfflinePersistence, QueueDrainWatcher } from './providersOffline'

/** Cached reads live as long as the persisted cache (offline use); fresh data still wins whenever online. */
const DAY_MS = 24 * 60 * 60 * 1000

function createQueryClient(): QueryClient {
  // TanStack assumes "online" until the first event: start from what the browser knows
  if (typeof navigator !== 'undefined') onlineManager.setOnline(navigator.onLine)
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: DAY_MS,
        retry: 1,
        refetchOnWindowFocus: true,
      },
      mutations: {
        // Writes outside the offline queue fail at once with "no connection" instead of a spinner that
        // waits forever; the queued writes (registered below) override this with networkMode 'online'.
        networkMode: 'always',
      },
    },
  })
  // Offline queue: defaults must exist before a persisted queue is restored (src/lib/offline).
  registerWorkoutQueue(client)
  registerSleepWaterQueue(client)
  registerTodayQueue(client)
  return client
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient)
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <OfflinePersistence>{children}</OfflinePersistence>
        <QueueDrainWatcher />
        <OfflineChip />
        <SyncSheet />
      </AuthProvider>
    </QueryClientProvider>
  )
}
