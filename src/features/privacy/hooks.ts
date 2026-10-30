import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { LEGAL } from '@/config/brand'
import * as api from './api'

export const consentKeys = { all: ['consents'] as const }

/** Consent state of the signed-in, approved user. */
export function useConsents() {
  const { status } = useAuth()
  const q = useQuery({ queryKey: consentKeys.all, queryFn: api.listConsents, enabled: status === 'ready', staleTime: 5 * 60_000 })
  const rows = q.data ?? []
  const noticeAcked = rows.some((r) => r.kind === 'privacy_notice' && r.granted && r.version === LEGAL.noticeVersion)
  // the newest health row decides (a withdrawal is a newer row with granted = false)
  const health = rows.find((r) => r.kind === 'health_data')?.granted ?? false
  const adult = rows.some((r) => r.kind === 'adult' && r.granted)
  // a consent to an older AI text does not count: the newest row must grant the current version
  const latestAi = rows.find((r) => r.kind === 'ai_processing')
  const ai = Boolean(latestAi?.granted && latestAi.version >= LEGAL.aiConsentVersion)
  return { ...q, noticeAcked, health, adult, ai }
}

/** Health-data tables (and anything derived from them) change meaning when consent changes. */
function useAfterHealthChange() {
  const qc = useQueryClient()
  const { refreshProfile } = useAuth()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: consentKeys.all }),
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'consents' }),
      refreshProfile(),
    ])
}

export function useAcknowledgeNotice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.acknowledgeNotice,
    onSuccess: () => qc.invalidateQueries({ queryKey: consentKeys.all }),
  })
}

/** AI consent changes what the AI status card says: refresh consents and availability. */
function useAfterAiChange() {
  const qc = useQueryClient()
  return () => Promise.all([qc.invalidateQueries({ queryKey: consentKeys.all }), qc.invalidateQueries({ queryKey: ['nutrition'] })])
}

export function useGrantAiConsent() {
  const after = useAfterAiChange()
  return useMutation({ mutationFn: api.grantAiConsent, onSuccess: () => void after() })
}

export function useWithdrawAiConsent() {
  const after = useAfterAiChange()
  return useMutation({ mutationFn: api.withdrawAiConsent, onSuccess: () => void after() })
}

export function useGrantHealthConsent() {
  const after = useAfterHealthChange()
  return useMutation({ mutationFn: api.grantHealthConsent, onSuccess: () => void after() })
}

export function useWithdrawHealthConsent() {
  const { user } = useAuth()
  const after = useAfterHealthChange()
  return useMutation({ mutationFn: () => api.withdrawHealthConsent(user!.id), onSuccess: () => void after() })
}

export function useExportMyData() {
  const { user, profile } = useAuth()
  return useMutation({
    mutationFn: async () => {
      const blob = await api.exportMyData(user!.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${profile?.username ?? 'data'}-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    },
  })
}

export function useDeleteMyAccount() {
  const { user, signOut } = useAuth()
  return useMutation({
    mutationFn: async () => {
      await api.deleteMyAccount(user!.id)
      await signOut()
    },
  })
}
