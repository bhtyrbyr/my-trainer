import { fromB64, newRecoveryCode, normalizeRecoveryCode, randomBytes, toB64 } from './encoding'
import { deriveKek, newKdfParams, type KdfParams } from './kdf'

/**
 * Photo vault: a random 256-bit master key, stored only wrapped (AES-GCM) under a key derived from
 * the user's photo password, and a second copy wrapped under a recovery code. The server keeps the
 * wrapped bytes and KDF parameters, never the password, the code or the master key.
 */
export type VaultRecord = {
  kdf: KdfParams
  wrapped_key: string
  wrap_iv: string
  recovery_kdf: KdfParams
  recovery_wrapped_key: string
  recovery_iv: string
}

export class WrongSecretError extends Error {
  constructor() {
    super('WRONG_SECRET')
  }
}

async function wrap(master: CryptoKey, secret: string, kdf: KdfParams): Promise<{ wrapped: string; iv: string }> {
  const kek = await deriveKek(secret, kdf)
  const iv = randomBytes(12)
  const wrapped = await crypto.subtle.wrapKey('raw', master, kek, { name: 'AES-GCM', iv })
  return { wrapped: toB64(wrapped), iv: toB64(iv) }
}

async function unwrap(secret: string, kdf: KdfParams, wrapped: string, iv: string, extractable: boolean): Promise<CryptoKey> {
  const kek = await deriveKek(secret, kdf)
  try {
    return await crypto.subtle.unwrapKey('raw', fromB64(wrapped), kek, { name: 'AES-GCM', iv: fromB64(iv) }, { name: 'AES-GCM', length: 256 }, extractable, [
      'encrypt',
      'decrypt',
    ])
  } catch {
    throw new WrongSecretError() // AES-GCM tag mismatch: wrong password / code
  }
}

/** New vault: returns the record to store, the recovery code to show once, and the session key. */
export async function createVault(password: string): Promise<{ record: VaultRecord; recoveryCode: string; key: CryptoKey }> {
  const master = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const recoveryCode = newRecoveryCode()
  const kdf = await newKdfParams()
  const recovery_kdf = await newKdfParams()
  const a = await wrap(master, password, kdf)
  const b = await wrap(master, normalizeRecoveryCode(recoveryCode), recovery_kdf)
  const record: VaultRecord = { kdf, wrapped_key: a.wrapped, wrap_iv: a.iv, recovery_kdf, recovery_wrapped_key: b.wrapped, recovery_iv: b.iv }
  // hand back a non-extractable copy for the session; the extractable one goes out of scope
  const key = await unwrap(password, kdf, a.wrapped, a.iv, false)
  return { record, recoveryCode, key }
}

export function unlockWithPassword(record: VaultRecord, password: string): Promise<CryptoKey> {
  return unwrap(password, record.kdf, record.wrapped_key, record.wrap_iv, false)
}

export function unlockWithRecovery(record: VaultRecord, code: string): Promise<CryptoKey> {
  return unwrap(normalizeRecoveryCode(code), record.recovery_kdf, record.recovery_wrapped_key, record.recovery_iv, false)
}

/**
 * New password, proven by the current password or the recovery code. Only the password wrap changes;
 * the recovery code keeps working.
 */
export async function rewrapPassword(record: VaultRecord, proof: { password: string } | { recoveryCode: string }, newPassword: string): Promise<VaultRecord> {
  const master =
    'password' in proof
      ? await unwrap(proof.password, record.kdf, record.wrapped_key, record.wrap_iv, true)
      : await unwrap(normalizeRecoveryCode(proof.recoveryCode), record.recovery_kdf, record.recovery_wrapped_key, record.recovery_iv, true)
  const kdf = await newKdfParams()
  const a = await wrap(master, newPassword, kdf)
  return { ...record, kdf, wrapped_key: a.wrapped, wrap_iv: a.iv }
}
