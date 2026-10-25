import { argon2id } from 'hash-wasm'
import { fromB64, randomBytes, toB64 } from './encoding'

/**
 * Key-encryption-key derivation for the photo vault. Argon2id with OWASP's lower-memory profile
 * (19 MiB, 2 passes) so it stays quick on a phone; PBKDF2-SHA256 (600k) if WebAssembly is
 * unavailable. The parameters travel with the vault record, so they can be raised later.
 */
export type KdfParams =
  | { alg: 'argon2id'; salt: string; m: number; t: number; p: number }
  | { alg: 'pbkdf2-sha256'; salt: string; iterations: number }

export const ARGON2_DEFAULT = { m: 19456, t: 2, p: 1 } as const
export const PBKDF2_ITERATIONS = 600_000

export async function newKdfParams(): Promise<KdfParams> {
  const salt = toB64(randomBytes(16))
  // PBKDF2 only where WebAssembly does not exist; any other Argon2 failure surfaces instead of
  // silently weakening the vault
  if (typeof WebAssembly !== 'object') return { alg: 'pbkdf2-sha256', salt, iterations: PBKDF2_ITERATIONS }
  return { alg: 'argon2id', salt, ...ARGON2_DEFAULT }
}

const within = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi

/**
 * Parameters come back from the server, so they are checked before use: a tampered record must
 * not make the device derive with a weak (or absurdly expensive) setting.
 */
export function assertKdfParams(params: KdfParams): void {
  let ok = false
  try {
    const saltLen = fromB64(params.salt).length
    if (saltLen >= 16 && saltLen <= 64) {
      if (params.alg === 'argon2id') ok = within(params.m, 19456, 262144) && within(params.t, 2, 10) && within(params.p, 1, 4)
      else if (params.alg === 'pbkdf2-sha256') ok = within(params.iterations, PBKDF2_ITERATIONS, 5_000_000)
    }
  } catch {
    ok = false
  }
  if (!ok) throw new Error('BAD_KDF')
}

/** Derive a non-extractable AES-GCM key that can only wrap/unwrap the master key. */
export async function deriveKek(secret: string, params: KdfParams): Promise<CryptoKey> {
  assertKdfParams(params)
  const salt = fromB64(params.salt)
  let raw: Uint8Array<ArrayBuffer>
  if (params.alg === 'argon2id') {
    raw = new Uint8Array(await argon2id({ password: secret.normalize('NFKC'), salt, parallelism: params.p, iterations: params.t, memorySize: params.m, hashLength: 32, outputType: 'binary' }))
  } else {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveBits'])
    raw = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: params.iterations }, base, 256))
  }
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['wrapKey', 'unwrapKey'])
  raw.fill(0)
  return key
}
