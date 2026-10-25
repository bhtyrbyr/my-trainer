import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import type { RegistrationStatus } from '@/lib/database.types'
import { listRegistrations, pendingCount, setRegistrationStatus } from './api'

export const adminKeys = {
  registrations: (status: string) => ['admin', 'registrations', status] as const,
  pendingCount: ['admin', 'pendingCount'] as const,
}

export function useIsAdmin() {
  const { profile } = useAuth()
  return profile?.role === 'admin'
}

export function usePendingCount() {
  const isAdmin = useIsAdmin()
  return useQuery({
    queryKey: adminKeys.pendingCount,
    queryFn: pendingCount,
    enabled: isAdmin,
    refetchInterval: 60_000,
  })
}

export function useRegistrations(status: RegistrationStatus | 'all') {
  const isAdmin = useIsAdmin()
  return useQuery({
    queryKey: adminKeys.registrations(status),
    queryFn: () => listRegistrations(status),
    enabled: isAdmin,
  })
}

export function useSetRegistrationStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: RegistrationStatus }) => setRegistrationStatus(userId, status),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['admin'] })
    },
  })
}
