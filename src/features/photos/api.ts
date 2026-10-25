import { downscaleJpeg } from '@/lib/image'
import { decryptJson, decryptPart, encryptJson, encryptPart, partAad } from '@/lib/crypto/aead'
import type { VaultRecord } from '@/lib/crypto/vault'
import type { KdfParams } from '@/lib/crypto/kdf'
import { supabase } from '@/lib/supabase'
import type { PhotoMeta, PhotoRow, Pose } from './types'

export const PHOTO_BUCKET = 'progress-photos'

export async function getVault(): Promise<VaultRecord | null> {
  const { data, error } = await supabase.from('photo_vault').select('kdf, wrapped_key, wrap_iv, recovery_kdf, recovery_wrapped_key, recovery_iv').maybeSingle()
  if (error) throw error
  if (!data) return null
  return { ...data, kdf: data.kdf as KdfParams, recovery_kdf: data.recovery_kdf as KdfParams }
}

/**
 * Creates the vault exactly once. Insert (never upsert): if a vault already exists, e.g. created in
 * another tab, overwriting it would make every stored photo undecryptable. Returns false then.
 */
export async function createVaultRow(userId: string, record: VaultRecord): Promise<boolean> {
  const { error } = await supabase.from('photo_vault').insert({ user_id: userId, ...record })
  if (error?.code === '23505') return false
  if (error) throw error
  return true
}

/** Password change / recovery: only the password wrap changes (the server keeps the recovery wrap). */
export async function updateVaultPassword(userId: string, record: VaultRecord): Promise<void> {
  const { error } = await supabase.from('photo_vault').update({ kdf: record.kdf, wrapped_key: record.wrapped_key, wrap_iv: record.wrap_iv }).eq('user_id', userId)
  if (error) throw error
}

export async function listPhotos(): Promise<PhotoRow[]> {
  const { data, error } = await supabase.from('progress_photos').select('*').order('taken_on', { ascending: false }).order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/**
 * Re-encode on the device (drops EXIF/location, caps size), encrypt image, thumbnail and note, then
 * upload ciphertext only. On a failed row insert the uploaded objects are removed again.
 */
export async function addPhoto(userId: string, key: CryptoKey, file: Blob, input: { takenOn: string; pose: Pose; meta: PhotoMeta }): Promise<void> {
  const id = crypto.randomUUID()
  const [image, thumb] = await Promise.all([downscaleJpeg(file, 1600, 0.85), downscaleJpeg(file, 360, 0.8)])
  const img = await encryptPart(key, await image.arrayBuffer(), partAad(userId, id, 'image'))
  const th = await encryptPart(key, await thumb.arrayBuffer(), partAad(userId, id, 'thumb'))
  const hasMeta = Boolean(input.meta.note?.trim()) || input.meta.weight != null
  const meta = hasMeta ? await encryptJson(key, input.meta, partAad(userId, id, 'meta')) : null
  const imagePath = `${userId}/${id}.img.bin`
  const thumbPath = `${userId}/${id}.thumb.bin`
  const bucket = supabase.storage.from(PHOTO_BUCKET)
  const opts = { contentType: 'application/octet-stream', upsert: false, cacheControl: '0' }
  const up1 = await bucket.upload(imagePath, new Blob([img.data], { type: 'application/octet-stream' }), opts)
  if (up1.error) throw up1.error
  const up2 = await bucket.upload(thumbPath, new Blob([th.data], { type: 'application/octet-stream' }), opts)
  if (up2.error) {
    await bucket.remove([imagePath])
    throw up2.error
  }
  const { error } = await supabase.from('progress_photos').insert({
    id,
    user_id: userId,
    taken_on: input.takenOn,
    pose: input.pose,
    image_path: imagePath,
    thumb_path: thumbPath,
    image_iv: img.iv,
    thumb_iv: th.iv,
    meta_cipher: meta?.data ?? null,
    meta_iv: meta?.iv ?? null,
  })
  if (error) {
    await bucket.remove([imagePath, thumbPath])
    throw error
  }
}

/** Download a part and decrypt it in memory; returns a Blob for an object URL (never persisted). */
export async function openPart(userId: string, key: CryptoKey, photo: PhotoRow, part: 'image' | 'thumb'): Promise<Blob> {
  const path = part === 'image' ? photo.image_path : photo.thumb_path
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).download(path)
  if (error) throw error
  const plain = await decryptPart(key, part === 'image' ? photo.image_iv : photo.thumb_iv, await data.arrayBuffer(), partAad(userId, photo.id, part))
  return new Blob([plain], { type: 'image/jpeg' })
}

export async function openMeta(userId: string, key: CryptoKey, photo: PhotoRow): Promise<PhotoMeta> {
  if (!photo.meta_cipher || !photo.meta_iv) return {}
  return decryptJson<PhotoMeta>(key, photo.meta_iv, photo.meta_cipher, partAad(userId, photo.id, 'meta'))
}

/** Row first (it is what the album shows), then the ciphertext; a leftover object is unreadable anyway. */
export async function deletePhoto(photo: PhotoRow): Promise<void> {
  const { error } = await supabase.from('progress_photos').delete().eq('id', photo.id)
  if (error) throw error
  const { error: sErr } = await supabase.storage.from(PHOTO_BUCKET).remove([photo.image_path, photo.thumb_path])
  if (sErr) console.error('progress photo objects not removed', sErr.message)
}
