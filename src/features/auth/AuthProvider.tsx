import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { clearUserData, forgetLastUser, isDifferentUser } from './clearUserData'
import type { Profile } from '@/lib/database.types'

/**
 * Auth state machine.
 *  loading     reading the persisted session
 *  signed-out  no session
 *  checking    session exists, loading the profile
 *  blocked     profile.is_blocked (admin action) -> access denied screen
 *  onboarding  signed in but no completed profile -> /onboarding (mandatory username + avatar)
 *  pending     onboarded, waiting for admin approval -> /pending
 *  rejected    admin rejected the registration -> /pending (rejected variant)
 *  ready       onboarded + approved, app may render
 */
export type AuthStatus = 'loading' | 'signed-out' | 'checking' | 'blocked' | 'onboarding' | 'pending' | 'rejected' | 'ready'

type AuthContextValue = {
  status: AuthStatus
  session: Session | null
  user: User | null
  profile: Profile | null
  error: string | null
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle()
  if (error) {
    console.error('profile load failed', error)
    return null
  }
  return data
}

function statusFor(profile: Profile | null): AuthStatus {
  if (!profile || !profile.onboarding_completed_at) return 'onboarding'
  if (profile.is_blocked) return 'blocked'
  if (profile.status === 'pending') return 'pending'
  if (profile.status === 'rejected') return 'rejected'
  return 'ready'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()

  useEffect(() => {
    let cancelled = false

    const evaluate = async (s: Session | null) => {
      if (cancelled) return
      setSession(s)
      if (!s) {
        setProfile(null)
        setStatus('signed-out')
        return
      }
      setStatus('checking')
      // Another account on the same device: drop the previous user's cached data first.
      if (isDifferentUser(s.user.id)) await clearUserData(qc)
      const p = await loadProfile(s.user.id)
      if (cancelled) return
      setProfile(p)
      setStatus(statusFor(p))
    }

    void supabase.auth.getSession().then(({ data }) => evaluate(data.session))

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'TOKEN_REFRESHED') {
        setSession(s)
        return
      }
      void evaluate(s)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [qc])

  const refreshProfile = useCallback(async () => {
    if (!session) return
    const p = await loadProfile(session.user.id)
    setProfile(p)
    setStatus(statusFor(p))
  }, [session])

  const signInWithGoogle = useCallback(async () => {
    setError(null)
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: 'select_account' },
      },
    })
    if (err) setError(err.message)
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    await clearUserData(qc)
    forgetLastUser()
    setSession(null)
    setProfile(null)
    setStatus('signed-out')
  }, [qc])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      profile,
      error,
      signInWithGoogle,
      signOut,
      refreshProfile,
    }),
    [status, session, profile, error, signInWithGoogle, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its provider on purpose
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
