// Regression test for the Edge Function's Web Push crypto (supabase/functions/push-send/webpush.ts).
// It was cross-checked once against the reference http_ece decryptor; this keeps it honest with an
// independent receiver-side implementation of RFC 8291 and a WebCrypto ECDSA verify.
import { describe, expect, it } from 'vitest'
import { b64urlToBytes, bytesToB64url, encryptPayload, vapidAuthorization } from '../../supabase/functions/push-send/webpush'

const enc = new TextEncoder()
const cat = (...p: Uint8Array[]) => {
  const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0))
  let i = 0
  for (const x of p) {
    o.set(x, i)
    i += x.length
  }
  return o
}
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) {
  const k = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, k, n * 8))
}

/** The browser's side: decrypt an aes128gcm body with the subscription's private key and auth secret. */
async function receive(body: Uint8Array, ua: CryptoKeyPair, auth: Uint8Array) {
  const salt = body.slice(0, 16)
  const idlen = body[20]
  const asPublic = body.slice(21, 21 + idlen)
  const cipher = body.slice(21 + idlen)
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256))
  const ikm = await hkdf(auth, secret, cat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, cipher))
  expect(plain[plain.length - 1]).toBe(2) // last-record delimiter
  return new TextDecoder().decode(plain.slice(0, -1))
}

describe('web push crypto', () => {
  it('encrypts a payload only the subscription can read', async () => {
    const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    const auth = crypto.getRandomValues(new Uint8Array(16))
    const p256dh = bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)))
    const payload = JSON.stringify({ body: 'Kitap oku, Su iç +1', url: '/track' })
    const body = await encryptPayload(enc.encode(payload), p256dh, bytesToB64url(auth))
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096)
    expect(await receive(body, ua, auth)).toBe(payload)
    // a different auth secret must not decrypt it
    await expect(receive(body, ua, crypto.getRandomValues(new Uint8Array(16)))).rejects.toThrow()
  })

  it('signs a VAPID token for the push service origin', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    const h = await vapidAuthorization('https://web.push.apple.com/abc', 'mailto:a@b.c', bytesToB64url(pub), jwk.d!, 1_800_000_000)
    const [, t, k] = /^vapid t=(.+), k=(.+)$/.exec(h)!
    expect(k).toBe(bytesToB64url(pub))
    const [hd, cl, sig] = t.split('.')
    expect(JSON.parse(new TextDecoder().decode(b64urlToBytes(cl)))).toEqual({ aud: 'https://web.push.apple.com', exp: 1_800_000_000 + 43200, sub: 'mailto:a@b.c' })
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, b64urlToBytes(sig), enc.encode(`${hd}.${cl}`))).toBe(true)
  })
})
