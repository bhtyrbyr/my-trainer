/** Byte helpers for the photo vault. No secrets are logged or persisted here. */

export function toB64(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

/** Crockford Base32 (no I, L, O, U): easy to read aloud and type. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function toBase32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/** A recovery code: 160 random bits as 32 Base32 characters, grouped by 4 ("XXXX-XXXX-..."). */
export function newRecoveryCode(): string {
  return toBase32(randomBytes(20)).match(/.{4}/g)!.join('-')
}

/** Accepts lower case, spaces, missing dashes and the usual look-alikes (O->0, I/L->1). */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V')
}

export function isRecoveryCodeShape(input: string): boolean {
  const n = normalizeRecoveryCode(input)
  return n.length === 32 && [...n].every((c) => ALPHABET.includes(c))
}
