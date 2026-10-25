// @vitest-environment node
/**
 * End-to-end check of the photo vault against a LOCAL Supabase stack (never production):
 *   PHOTO_E2E_URL, PHOTO_E2E_ANON, PHOTO_E2E_EMAIL, PHOTO_E2E_PASSWORD, PHOTO_E2E_OTHER_EMAIL
 * Skipped unless PHOTO_E2E_URL is set. Proves that what lands in Storage is ciphertext, that it
 * decrypts with the password, and that another account can neither read the row nor the object.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { decryptPart, encryptPart, partAad } from './aead'
import { createVault, unlockWithPassword, type VaultRecord } from './vault'

const env = process.env
const URL_ = env.PHOTO_E2E_URL

describe.skipIf(!URL_)('photo vault end to end (local stack)', () => {
  it('stores only ciphertext and keeps it private', async () => {
    const sb = createClient(URL_!, env.PHOTO_E2E_ANON!, { auth: { persistSession: false } })
    const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: env.PHOTO_E2E_EMAIL!, password: env.PHOTO_E2E_PASSWORD! })
    expect(authErr).toBeNull()
    const uid = auth.user!.id

    const { record, key } = await createVault('e2e photo password')
    const { error: vErr } = await sb.from('photo_vault').insert({ user_id: uid, ...record })
    expect(vErr).toBeNull()

    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 4096 }, (_, i) => (i * 7) % 256)])
    const id = crypto.randomUUID()
    const img = await encryptPart(key, jpeg, partAad(uid, id, 'image'))
    const th = await encryptPart(key, jpeg.slice(0, 1024), partAad(uid, id, 'thumb'))
    const bucket = sb.storage.from('progress-photos')
    const opts = { contentType: 'application/octet-stream', upsert: false }
    expect((await bucket.upload(`${uid}/${id}.img.bin`, new Blob([img.data], { type: 'application/octet-stream' }), opts)).error).toBeNull()
    expect((await bucket.upload(`${uid}/${id}.thumb.bin`, new Blob([th.data], { type: 'application/octet-stream' }), opts)).error).toBeNull()
    // a plain JPEG is refused by the bucket (ciphertext only)
    const plain = await bucket.upload(`${uid}/${id}.plain.jpg`, new Blob([jpeg], { type: 'image/jpeg' }), { contentType: 'image/jpeg' })
    expect(plain.error).not.toBeNull()

    const { error: rowErr } = await sb.from('progress_photos').insert({
      id,
      user_id: uid,
      taken_on: new Date().toISOString().slice(0, 10),
      pose: 'front',
      image_path: `${uid}/${id}.img.bin`,
      thumb_path: `${uid}/${id}.thumb.bin`,
      image_iv: img.iv,
      thumb_iv: th.iv,
    })
    expect(rowErr).toBeNull()

    // what the server holds is not a JPEG and decrypts only with the password
    const { data: raw } = await bucket.download(`${uid}/${id}.img.bin`)
    const bytes = new Uint8Array(await raw!.arrayBuffer())
    expect([bytes[0], bytes[1]]).not.toEqual([0xff, 0xd8])
    const { data: vault } = await sb.from('photo_vault').select('*').single()
    const k = await unlockWithPassword(vault as unknown as VaultRecord, 'e2e photo password')
    expect(new Uint8Array(await decryptPart(k, img.iv, bytes, partAad(uid, id, 'image')))).toEqual(jpeg)

    // another account sees nothing
    const other = createClient(URL_!, env.PHOTO_E2E_ANON!, { auth: { persistSession: false } })
    const o = await other.auth.signInWithPassword({ email: env.PHOTO_E2E_OTHER_EMAIL!, password: env.PHOTO_E2E_PASSWORD! })
    expect(o.error).toBeNull()
    expect((await other.from('progress_photos').select('id')).data).toEqual([])
    expect((await other.from('photo_vault').select('user_id')).data).toEqual([])
    expect((await other.storage.from('progress-photos').download(`${uid}/${id}.img.bin`)).error).not.toBeNull()

    // clean up
    await bucket.remove([`${uid}/${id}.img.bin`, `${uid}/${id}.thumb.bin`])
    await sb.from('progress_photos').delete().eq('id', id)
  }, 60_000)
})
