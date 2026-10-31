// LOCAL Supabase only. Keys are read at runtime from `supabase status` and never written to the repo.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const ORIGIN = 'http://localhost:5180'
export const AUTH_DIR = fileURLToPath(new URL('../.auth/', import.meta.url))
export const STATE_FILE = `${AUTH_DIR}user.json`
export const META_FILE = `${AUTH_DIR}meta.json`
/** Custom exercise created for the test user in global setup (the local stack has no synced catalog). */
export const E2E_EXERCISE = 'E2E Bench Press'

export type LocalStack = { url: string; anonKey: string; serviceKey: string }

/** Reads the local stack once per process tree (workers inherit the env set by the runner). */
export function localStack(): LocalStack {
  const e = process.env
  if (!e.E2E_SUPABASE_URL) {
    const bin = e.SUPABASE_BIN ?? 'npx supabase' // CI uses the pinned CLI from supabase/setup-cli
    const out = execSync(`${bin} status -o env`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const env = Object.fromEntries(
      out
        .split(/\r?\n/)
        .map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim()))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => [m[1], m[2]]),
    )
    e.E2E_SUPABASE_URL = env.API_URL
    e.E2E_ANON_KEY = env.ANON_KEY
    e.E2E_SERVICE_KEY = env.SERVICE_ROLE_KEY
  }
  const url = e.E2E_SUPABASE_URL ?? ''
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) throw new Error(`E2E needs a LOCAL Supabase stack (npx supabase start), got "${url}"`)
  return { url, anonKey: e.E2E_ANON_KEY!, serviceKey: e.E2E_SERVICE_KEY! }
}

export type TestUser = { id: string; email: string; accessToken: string }

export function testUser(): TestUser {
  return JSON.parse(readFileSync(META_FILE, 'utf8')) as TestUser
}

/** PostgREST read as the test user (RLS applies, exactly like the app). */
export async function restAsUser<T = unknown>(path: string): Promise<T> {
  const { url, anonKey } = localStack()
  const r = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: anonKey, authorization: `Bearer ${testUser().accessToken}` } })
  if (!r.ok) throw new Error(`REST ${path}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T
}
