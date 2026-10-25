import { describe, expect, it } from 'vitest'
import { decryptJson, decryptPart, encryptJson, encryptPart, partAad } from './aead'
import { isRecoveryCodeShape, normalizeRecoveryCode, toBase32 } from './encoding'
import { createVault, rewrapPassword, unlockWithPassword, unlockWithRecovery, WrongSecretError } from './vault'

// A tiny JPEG-looking payload: SOI marker + some bytes
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 200 }, (_, i) => i % 256)])

describe('photo vault', () => {
  it('encrypts and decrypts with the password and the recovery code; rejects a wrong password', async () => {
    const { record, recoveryCode, key } = await createVault('correct horse battery')
    expect(record.kdf.alg).toBe('argon2id')
    expect(JSON.stringify(record)).not.toContain('correct horse battery')
    expect(isRecoveryCodeShape(recoveryCode)).toBe(true)

    const aad = partAad('user-1', 'photo-1', 'image')
    const { iv, data } = await encryptPart(key, JPEG, aad)
    // what leaves the device is not a JPEG
    expect([data[0], data[1]]).not.toEqual([0xff, 0xd8])
    expect(data.length).toBe(JPEG.length + 16)

    const byPassword = await unlockWithPassword(record, 'correct horse battery')
    expect(new Uint8Array(await decryptPart(byPassword, iv, data, aad))).toEqual(JPEG)
    const byCode = await unlockWithRecovery(record, recoveryCode.toLowerCase().replace(/-/g, ' '))
    expect(new Uint8Array(await decryptPart(byCode, iv, data, aad))).toEqual(JPEG)

    await expect(unlockWithPassword(record, 'wrong password')).rejects.toBeInstanceOf(WrongSecretError)
    expect(byPassword.extractable).toBe(false)
  }, 30_000)

  it('binds ciphertext to its owner, photo and part', async () => {
    const { key } = await createVault('another password!')
    const { iv, data } = await encryptPart(key, JPEG, partAad('u', 'p1', 'image'))
    await expect(decryptPart(key, iv, data, partAad('u', 'p2', 'image'))).rejects.toThrow()
    await expect(decryptPart(key, iv, data, partAad('u', 'p1', 'thumb'))).rejects.toThrow()
    const meta = await encryptJson(key, { note: 'cut week 3', weight: 81.4 }, partAad('u', 'p1', 'meta'))
    expect(await decryptJson(key, meta.iv, meta.data, partAad('u', 'p1', 'meta'))).toEqual({ note: 'cut week 3', weight: 81.4 })
  }, 30_000)

  it('changes the password via the recovery code without losing access', async () => {
    const { record, recoveryCode, key } = await createVault('old password 1')
    const aad = partAad('u', 'p', 'thumb')
    const { iv, data } = await encryptPart(key, JPEG, aad)
    const next = await rewrapPassword(record, { recoveryCode }, 'brand new pass')
    await expect(unlockWithPassword(next, 'old password 1')).rejects.toBeInstanceOf(WrongSecretError)
    const k = await unlockWithPassword(next, 'brand new pass')
    expect(new Uint8Array(await decryptPart(k, iv, data, aad))).toEqual(JPEG)
    await expect(unlockWithRecovery(next, recoveryCode)).resolves.toBeTruthy()
  }, 30_000)

  it('normalizes recovery codes typed by hand', () => {
    expect(normalizeRecoveryCode('abcd-efgh io lu')).toBe('ABCDEFGH101V')
    expect(toBase32(new Uint8Array([0xff]))).toBe('ZW')
  })
})
