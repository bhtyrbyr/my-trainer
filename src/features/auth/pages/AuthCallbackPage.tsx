import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../AuthProvider'
import { FullScreenSpinner } from '@/components/layout/FullScreenSpinner'

/**
 * supabase-js exchanges the PKCE code automatically (detectSessionInUrl). We wait for the state machine.
 * If the DB trigger rejected the sign-up (invite mode), Supabase redirects here with an error in the URL.
 */
export function AuthCallbackPage() {
  const { t } = useTranslation('auth')
  const { status } = useAuth()
  const navigate = useNavigate()

  const urlError = useMemo(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const query = new URLSearchParams(window.location.search)
    return hash.get('error_description') ?? query.get('error_description') ?? hash.get('error') ?? query.get('error')
  }, [])

  useEffect(() => {
    if (urlError) {
      navigate('/denied', { replace: true, state: { reason: urlError } })
      return
    }
    if (status === 'ready') navigate('/', { replace: true })
    else if (status === 'onboarding') navigate('/onboarding', { replace: true })
    else if (status === 'pending' || status === 'rejected') navigate('/pending', { replace: true })
    else if (status === 'blocked') navigate('/denied', { replace: true })
    else if (status === 'signed-out') {
      const id = window.setTimeout(() => navigate('/login', { replace: true }), 3000)
      return () => window.clearTimeout(id)
    }
  }, [status, urlError, navigate])

  return <FullScreenSpinner label={t('callback')} />
}
