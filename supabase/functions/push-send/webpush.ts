// Web Push without dependencies: RFC 8291 message encryption (aes128gcm, RFC 8188) and RFC 8292 VAPID
// signing, on WebCrypto only, so the same file runs in the Deno Edge Function and in Vitest (Node).

const enc = new TextEncoder()

export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToB64url(b: Uint8Array): string {
  let bin = ''
  for (const x of b) bin += String.fromCharCode(x)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

/**
 * Encrypt `payload` for one subscription (keys.p256dh, keys.auth). Returns the aes128gcm body: a
 * header (salt, record size, sender public key) and a single record. `fixed` is for tests only.
 */
export async function encryptPayload(
  payload: Uint8Array<ArrayBuffer>,
  p256dh: string,
  authSecret: string,
  fixed?: { salt: Uint8Array<ArrayBuffer>; senderKeys: CryptoKeyPair },
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlToBytes(p256dh)
  const auth = b64urlToBytes(authSecret)
  if (uaPublic.length !== 65 || auth.length !== 16) throw new Error('BAD_SUBSCRIPTION_KEYS')
  const sender = fixed?.senderKeys ?? (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']))
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256))

  // RFC 8291 3.4: IKM bound to both public keys, then RFC 8188 content key and nonce
  const ikm = await hkdf(auth, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  // single record: payload + 0x02 delimiter (last record), no padding
  const plain = concat(payload, new Uint8Array([2]))
  if (plain.length + 16 > 4096) throw new Error('PAYLOAD_TOO_LARGE')
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain))

  const rs = new Uint8Array([0, 0, 16, 0]) // 4096, big endian
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher)
}

/** VAPID (RFC 8292): an ES256 JWT for the push service's origin. Keys as from `web-push generate-vapid-keys`. */
export async function vapidAuthorization(endpoint: string, subject: string, publicKey: string, privateKey: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const pub = b64urlToBytes(publicKey)
  if (pub.length !== 65) throw new Error('BAD_VAPID_PUBLIC_KEY')
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)), d: privateKey, ext: false }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = bytesToB64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: subject })))
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)))
  return `vapid t=${header}.${claims}.${bytesToB64url(signature)}, k=${publicKey}`
}
