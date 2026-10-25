import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { createVault, rewrapPassword, unlockWithPassword, unlockWithRecovery } from '@/lib/crypto/vault'
import * as api from './api'
import { setSessionKey } from './keyStore'
import { cacheGeneration, cacheUrl, cachedUrl, dropUrl } from './photoCache'
import type { PhotoMeta, PhotoRow, Pose } from './types'

export const photoKeys = {
  all: ['photos'] as const,
  vault: ['photos', 'vault'] as const,
  list: ['photos', 'list'] as const,
}

export function useVault() {
  return useQuery({ queryKey: photoKeys.vault, queryFn: api.getVault, staleTime: Infinity })
}

export function usePhotoList(enabled = true) {
  return useQuery({ queryKey: photoKeys.list, queryFn: api.listPhotos, enabled })
}

/**
 * First-time setup: returns the recovery code to show once; the session is unlocked right away.
 * Returns null when a vault turned out to exist already (stale screen, another tab): the page then
 * shows the unlock screen instead of replacing the vault.
 */
export function useCreateVault() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async ({ password, remember }: { password: string; remember: boolean }): Promise<string | null> => {
      const existing = await api.getVault()
      if (existing) {
        qc.setQueryData(photoKeys.vault, existing)
        return null
      }
      const { record, recoveryCode, key } = await createVault(password)
      if (!(await api.createVaultRow(user!.id, record))) {
        await qc.invalidateQueries({ queryKey: photoKeys.vault })
        return null
      }
      await setSessionKey(user!.id, key, remember)
      qc.setQueryData(photoKeys.vault, record)
      return recoveryCode
    },
  })
}

export function useUnlock() {
  const { user } = useAuth()
  const vault = useVault()
  return useMutation({
    mutationFn: async ({ password, remember }: { password: string; remember: boolean }) => {
      const key = await unlockWithPassword(vault.data!, password)
      await setSessionKey(user!.id, key, remember)
    },
  })
}

/** Forgot the password: prove with the recovery code, set a new password, unlock. */
export function useRecover() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const vault = useVault()
  return useMutation({
    mutationFn: async ({ code, newPassword, remember }: { code: string; newPassword: string; remember: boolean }) => {
      const record = await rewrapPassword(vault.data!, { recoveryCode: code }, newPassword)
      const key = await unlockWithRecovery(record, code)
      await api.updateVaultPassword(user!.id, record)
      await setSessionKey(user!.id, key, remember)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: photoKeys.vault }),
  })
}

export function useChangePassword() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const vault = useVault()
  return useMutation({
    mutationFn: async ({ current, next }: { current: string; next: string }) => {
      const record = await rewrapPassword(vault.data!, { password: current }, next)
      await api.updateVaultPassword(user!.id, record)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: photoKeys.vault }),
  })
}

function useAfterPhotoChange() {
  const qc = useQueryClient()
  const { refreshProfile } = useAuth()
  return () => Promise.all([qc.invalidateQueries({ queryKey: photoKeys.list }), qc.invalidateQueries({ queryKey: ['leaderboard'] }), refreshProfile()])
}

export function useAddPhoto(key: CryptoKey | null) {
  const { user } = useAuth()
  const after = useAfterPhotoChange()
  return useMutation({
    mutationFn: (input: { file: Blob; takenOn: string; pose: Pose; meta: PhotoMeta }) => api.addPhoto(user!.id, key!, input.file, input),
    onSuccess: () => void after(),
  })
}

export function useDeletePhoto() {
  const after = useAfterPhotoChange()
  return useMutation({
    mutationFn: (photo: PhotoRow) => api.deletePhoto(photo),
    onSuccess: (_, photo) => {
      dropUrl(`${photo.id}:image`)
      dropUrl(`${photo.id}:thumb`)
      void after()
    },
  })
}

/** Decrypted image as an in-memory object URL (cached while unlocked). */
export function useDecryptedUrl(photo: PhotoRow | null, part: 'image' | 'thumb', key: CryptoKey | null) {
  const { user } = useAuth()
  const id = photo ? `${photo.id}:${part}` : ''
  const [state, setState] = useState<{ url: string | null; error: unknown }>(() => ({ url: id ? (cachedUrl(id) ?? null) : null, error: null }))
  useEffect(() => {
    if (!photo || !key || !user) return
    const hit = cachedUrl(id)
    if (hit) {
      setState({ url: hit, error: null })
      return
    }
    let alive = true
    const gen = cacheGeneration()
    setState({ url: null, error: null })
    api
      .openPart(user.id, key, photo, part)
      .then((blob) => {
        // locked meanwhile: cacheUrl refuses, nothing decrypted outlives the lock
        if (alive) setState({ url: cacheUrl(id, blob, gen), error: null })
      })
      .catch((error: unknown) => {
        if (alive) setState({ url: null, error })
      })
    return () => {
      alive = false
    }
  }, [photo, key, user, id, part])
  return state
}

export function useDecryptedMeta(photo: PhotoRow | null, key: CryptoKey | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['photos', 'meta', photo?.id ?? ''],
    queryFn: () => api.openMeta(user!.id, key!, photo!),
    enabled: Boolean(photo && key && user && photo.meta_cipher),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  })
}
