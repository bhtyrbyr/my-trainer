// Creates three throwaway, onboarded, approved adult users on the LOCAL stack and saves a signed-in
// storageState for each (A is the default for every spec; B is the second person in the social spec;
// C is a stranger used through the API only).
// Google OAuth is not usable in tests, so the users get an email/password identity through the local
// admin API; the app only ever sees a normal Supabase session in localStorage.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { AUTH_DIR, E2E_EXERCISE, META_FILE, META_FILE_B, META_FILE_C, ORIGIN, STATE_FILE, STATE_FILE_B, localStack, type TestUser } from './support/env'

const brand = JSON.parse(readFileSync(new URL('../src/config/brand.json', import.meta.url), 'utf8')) as {
  legal: { noticeVersion: string; healthConsentVersion: string }
}
const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? 'supabase_db_my-trainer'

export function psql(sql: string): void {
  execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], {
    input: sql,
    stdio: ['pipe', 'ignore', 'inherit'],
  })
}

async function createUser(tag: string, stateFile: string, metaFile: string, extraSql = ''): Promise<void> {
  const { url, anonKey, serviceKey } = localStack()
  const stamp = `${tag}${Date.now().toString(36)}`
  const email = `e2e-${stamp}@example.test`
  const password = `e2e-${crypto.randomUUID()}`
  const admin = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' }

  let r = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })
  if (!r.ok) throw new Error(`create user: ${r.status} ${await r.text()}`)
  const uid = ((await r.json()) as { id: string }).id

  // Onboarding (private details first, then the public profile), approval and consents, in one transaction.
  // Approval needs app.internal (the profiles column-protection trigger otherwise keeps status = pending).
  // Birth year 1990: both users are adults (the social side is 18+).
  const v = brand.legal
  psql(`begin;
set local app.internal = 'on';
insert into public.profile_private (user_id, birth_year, height_cm, start_weight_kg, sex, goal)
  values ('${uid}', 1990, 178, 80, null, null);
insert into public.profiles (user_id, username, display_name, avatar_path, onboarding_completed_at)
  values ('${uid}', 'e2e${stamp}', 'E2E ${stamp}', '${uid}/avatar.jpg', now());
update public.profiles set status = 'approved', status_changed_at = now() where user_id = '${uid}';
-- tour_completed_at: the first-run tour would cover every screen; tour.spec resets it for its own check
insert into public.user_settings (user_id, locale, tour_completed_at) values ('${uid}', 'en', now())
  on conflict (user_id) do update set locale = 'en', tour_completed_at = now();
insert into public.user_consents (user_id, kind, version, granted) values
  ('${uid}', 'privacy_notice', '${v.noticeVersion}', true),
  ('${uid}', 'adult', '${v.noticeVersion}', true),
  ('${uid}', 'health_data', '${v.healthConsentVersion}', true);
${extraSql.replaceAll('$UID', uid)}
commit;`)

  r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!r.ok) throw new Error(`sign in: ${r.status} ${await r.text()}`)
  const session = (await r.json()) as { access_token: string }

  // supabase-js storage key: sb-<first label of the API host>-auth-token
  const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
  writeFileSync(
    stateFile,
    JSON.stringify({
      cookies: [],
      origins: [
        {
          origin: ORIGIN,
          localStorage: [
            { name: storageKey, value: JSON.stringify(session) },
            { name: 'mt.locale', value: 'en' },
            { name: 'mt.lastUserId', value: uid },
          ],
        },
      ],
    }),
  )
  const meta: TestUser = { id: uid, email, accessToken: session.access_token, username: `e2e${stamp}` }
  writeFileSync(metaFile, JSON.stringify(meta))
}

export default async function globalSetup(): Promise<void> {
  mkdirSync(AUTH_DIR, { recursive: true })
  // the local stack has no synced catalog: one custom exercise for the workout spec
  await createUser(
    '',
    STATE_FILE,
    META_FILE,
    `insert into public.exercises (source, is_custom, user_id, name_en, name_tr, body_parts, target_muscles, equipment)
  values ('custom', true, '$UID', '${E2E_EXERCISE}', '${E2E_EXERCISE}', '{chest}', '{pectorals}', '{barbell}');`,
  )
  await createUser('b', STATE_FILE_B, META_FILE_B)
  await createUser('c', `${AUTH_DIR}user-c.json`, META_FILE_C)
}
