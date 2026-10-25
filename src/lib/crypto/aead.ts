import { fromB64, randomBytes, toB64 } from './encoding'

/**
 * AES-256-GCM for photo parts. Every part is bound to its owner, photo and role through the
 * additional authenticated data, so a ciphertext cannot be swapped into another row or slot.
 */
export function partAad(userId: string, photoId: string, part: 'image' | 'thumb' | 'meta'): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`my-trainer/photo/v1:${userId}:${photoId}:${part}`)
}

export async function encryptPart(key: CryptoKey, plain: ArrayBuffer | Uint8Array<ArrayBuffer>, aad: Uint8Array<ArrayBuffer>): Promise<{ iv: string; data: Uint8Array<ArrayBuffer> }> {
  const iv = randomBytes(12)
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plain))
  return { iv: toB64(iv), data }
}

export async function decryptPart(key: CryptoKey, iv: string, data: ArrayBuffer | Uint8Array<ArrayBuffer>, aad: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: aad }, key, data)
}

export async function encryptJson(key: CryptoKey, value: unknown, aad: Uint8Array<ArrayBuffer>): Promise<{ iv: string; data: string }> {
  const { iv, data } = await encryptPart(key, new TextEncoder().encode(JSON.stringify(value)), aad)
  return { iv, data: toB64(data) }
}

export async function decryptJson<T>(key: CryptoKey, iv: string, data: string, aad: Uint8Array<ArrayBuffer>): Promise<T> {
  const plain = await decryptPart(key, iv, fromB64(data), aad)
  return JSON.parse(new TextDecoder().decode(plain)) as T
}
