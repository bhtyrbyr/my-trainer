import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { tracedFetch } from './requestTrace'

const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

/** True when the build was produced without Supabase config. The app shows a clear error instead of crashing. */
export const supabaseConfigured = Boolean(rawUrl && /^https?:\/\//.test(rawUrl) && rawKey)

if (!supabaseConfigured) {
  console.error('Missing or invalid VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local.')
}

export const supabase = createClient<Database>(
  supabaseConfigured ? rawUrl! : 'https://placeholder.supabase.co',
  supabaseConfigured ? rawKey! : 'placeholder',
  {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    // keeps an in-memory trace of recent requests for user-initiated error reports (see requestTrace.ts)
    global: { fetch: tracedFetch },
  },
)
