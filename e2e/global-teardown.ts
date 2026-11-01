import { existsSync, readFileSync, rmSync } from 'node:fs'
import { AUTH_DIR, META_FILE, META_FILE_B, localStack, type TestUser } from './support/env'

/** Deletes both throwaway users (their rows cascade) and the saved sessions. */
export default async function globalTeardown(): Promise<void> {
  const { url, serviceKey } = localStack()
  for (const file of [META_FILE, META_FILE_B]) {
    if (!existsSync(file)) continue
    const { id } = JSON.parse(readFileSync(file, 'utf8')) as TestUser
    const r = await fetch(`${url}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
    })
    if (!r.ok && r.status !== 404) console.warn(`e2e teardown: could not delete ${id}: ${r.status} ${await r.text()}`)
  }
  rmSync(AUTH_DIR, { recursive: true, force: true })
}
