import { existsSync, rmSync } from 'node:fs'
import { AUTH_DIR, META_FILE, localStack, testUser } from './support/env'

/** Deletes the throwaway user (its rows cascade) and the saved session. */
export default async function globalTeardown(): Promise<void> {
  if (!existsSync(META_FILE)) return
  const { url, serviceKey } = localStack()
  const { id } = testUser()
  const r = await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  })
  if (!r.ok && r.status !== 404) console.warn(`e2e teardown: could not delete ${id}: ${r.status} ${await r.text()}`)
  rmSync(AUTH_DIR, { recursive: true, force: true })
}
