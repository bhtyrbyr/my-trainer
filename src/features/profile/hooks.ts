import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  getProfilePrivate,
  removeAvatar,
  saveProfileEdit,
  setAvatarPath,
  setLeaderboardVisibility,
  uploadAvatar,
} from './api'
import type { ProfileEditValues } from './schema'

export const profileKeys = {
  private: ['profile', 'private'] as const,
}

/** Own private details (height, birth year, sex, goal, target weight). Never written to IndexedDB. */
export function useProfilePrivate(enabled = true) {
  return useQuery({ queryKey: profileKeys.private, queryFn: getProfilePrivate, enabled, meta: { persist: false } })
}

/**
 * Save the edit screen: private then public fields, then the new avatar (replacing the old object),
 * then refresh the session profile and everything derived from these fields.
 */
export function useSaveProfile() {
  const { user, profile, refreshProfile } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ values, avatar }: { values: ProfileEditValues; avatar: Blob | null }) => {
      if (!user || !profile) throw new Error('not signed in')
      // text fields first: a taken username or cooldown fails before the photo is replaced
      await saveProfileEdit(user.id, values, { usernameChanged: values.username !== profile.username.toLowerCase() })
      if (!avatar) return
      // storage policy allows exactly <uid>/avatar.(jpg|webp): the upload overwrites the old object
      const path = await uploadAvatar(user.id, avatar)
      // re-pointing the row bumps updated_at, the cache key of every avatar URL
      await setAvatarPath(user.id, path)
      if (profile.avatar_path && profile.avatar_path !== path) {
        await removeAvatar(profile.avatar_path).catch((e) => console.warn('old avatar not removed', e))
      }
    },
    onSuccess: async () => {
      await refreshProfile()
      void qc.invalidateQueries({ queryKey: profileKeys.private })
      void qc.invalidateQueries({ queryKey: ['body'] })
      void qc.invalidateQueries({ queryKey: ['leaderboard'] })
      void qc.invalidateQueries({ queryKey: ['nutrition', 'ai-availability'] }) // AI gate depends on the birth year
    },
  })
}

export function useLeaderboardVisibility() {
  const { user, refreshProfile } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (visible: boolean) => {
      if (!user) throw new Error('not signed in')
      return setLeaderboardVisibility(user.id, visible)
    },
    onSuccess: async () => {
      await refreshProfile()
      void qc.invalidateQueries({ queryKey: ['leaderboard'] })
    },
  })
}
