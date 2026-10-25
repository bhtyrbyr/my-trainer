import { useSyncExternalStore } from 'react'
import { clearPhotoCache } from './photoCache'

/**
 * Session key for the photo vault. Lives in memory; with "remember on this device" the same
 * non-extractable CryptoKey is also kept in IndexedDB (the raw key bytes cannot be read back out).
 * Plaintext photos are never stored anywhere (CLAUDE.md rule 5). Sign-out and lock clear both.
 */
const DB = 'mt-vault'
const STORE = 'keys'
let current: { userId: string; key: CryptoKey } | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  try {
    const db = await openDb()
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return undefined // private mode / storage blocked: the key just is not remembered
  }
}

export function getSessionKey(userId: string): CryptoKey | null {
  return current?.userId === userId ? current.key : null
}

export async function setSessionKey(userId: string, key: CryptoKey, remember: boolean): Promise<void> {
  current = { userId, key }
  if (remember && !key.extractable) await idb('readwrite', (s) => s.put(key, userId))
  else await idb('readwrite', (s) => s.delete(userId))
  emit()
}

/** Pick up a remembered key after a reload. */
export async function restoreSessionKey(userId: string): Promise<boolean> {
  if (getSessionKey(userId)) return true
  const key = await idb<CryptoKey>('readonly', (s) => s.get(userId))
  if (key instanceof CryptoKey) {
    current = { userId, key }
    emit()
    return true
  }
  return false
}

export async function lockVault(userId: string): Promise<void> {
  if (current?.userId === userId) current = null
  clearPhotoCache()
  emit() // the screen locks now, not after IndexedDB answers
  await idb('readwrite', (s) => s.delete(userId))
}

/** Sign-out / account switch: forget every key on this device. */
export async function forgetAllVaultKeys(): Promise<void> {
  current = null
  clearPhotoCache()
  emit()
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB)
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    })
  } catch {
    /* ignore */
  }
}

export function useSessionKey(userId: string | undefined): CryptoKey | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => (userId ? getSessionKey(userId) : null),
  )
}
