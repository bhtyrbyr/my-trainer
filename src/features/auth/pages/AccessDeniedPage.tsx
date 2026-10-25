import { useTranslation } from 'react-i18next'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'
import { useAuth } from '../AuthProvider'
import { Button } from '@/components/ui/button'

/**
 * Shown when: the account is blocked by an admin, or (invite mode) the Google account was not on the list
 * and the DB trigger rejected the sign-up (reason arrives via router state from the callback page).
 */
export function AccessDeniedPage() {
  const { t } = useTranslation('auth')
  const { status, user, signOut } = useAuth()
  const navigate = useNavigate()
  const { state } = useLocation() as { state?: { reason?: string } }
  const email = user?.email ?? ''
  const inviteRejected = Boolean(state?.reason) && status !== 'blocked'

  if (status === 'ready') return <Navigate to="/" replace />
  if (status === 'onboarding') return <Navigate to="/onboarding" replace />

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-6 text-center pt-safe pb-safe">
      <div className="flex size-20 items-center justify-center rounded-3xl bg-red-500/15 text-red-400">
        <ShieldOff className="size-10" aria-hidden />
      </div>
      <h1 className="text-2xl font-bold">{t('denied.title')}</h1>
      <p className="text-slate-400">
        {inviteRejected ? t('denied.inviteOnly') : status === 'blocked' ? t('denied.blocked', { email }) : t('denied.generic')}
      </p>
      <Button
        variant="secondary"
        onClick={() => {
          void signOut().then(() => navigate('/login', { replace: true }))
        }}
      >
        {t('denied.backToLogin')}
      </Button>
    </div>
  )
}
