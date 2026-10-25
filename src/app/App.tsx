import { RouterProvider } from 'react-router-dom'
import { Providers } from './providers'
import { router } from './router'
import { UpdatePrompt } from './UpdatePrompt'
import { supabaseConfigured } from '@/lib/supabase'

export function App() {
  if (!supabaseConfigured) {
    // Build-time misconfiguration: say so plainly instead of a black screen.
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="eyebrow">My Trainer</p>
        <h1 className="display text-[28px]">Configuration missing</h1>
        <p className="text-sm text-ink-muted">
          This build has no Supabase URL / anon key. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY and redeploy.
        </p>
      </div>
    )
  }
  return (
    <Providers>
      <RouterProvider router={router} />
      <UpdatePrompt />
    </Providers>
  )
}
