import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import type { Database, UserSettings } from '@/lib/database.types'
import { fetchUserSettings, upsertUserSettings } from './api'

type SettingsUpdate = Database['public']['Tables']['user_settings']['Update']

export const settingsKeys = {
  all: ['settings'] as const,
  me: (userId: string) => ['settings', userId] as const,
}

export function useUserSettings() {
  const { user } = useAuth()
  const { i18n } = useTranslation()
  const qc = useQueryClient()
  const userId = user?.id ?? ''

  const query = useQuery({
    queryKey: settingsKeys.me(userId),
    queryFn: () => fetchUserSettings(userId),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  })

  // Server-side locale wins over the device default once loaded (keeps phone and desktop in sync).
  useEffect(() => {
    const locale = query.data?.locale
    if (locale && locale !== i18n.resolvedLanguage) void i18n.changeLanguage(locale)
  }, [query.data?.locale, i18n])

  const updateSettings = useMutation({
    mutationFn: (patch: SettingsUpdate) => upsertUserSettings(userId, patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: settingsKeys.me(userId) })
      const prev = qc.getQueryData<UserSettings | null>(settingsKeys.me(userId))
      if (prev) qc.setQueryData<UserSettings>(settingsKeys.me(userId), { ...prev, ...patch })
      return { prev }
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(settingsKeys.me(userId), ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.me(userId) }),
  })

  return { settings: query.data ?? null, isLoading: query.isLoading, updateSettings }
}
