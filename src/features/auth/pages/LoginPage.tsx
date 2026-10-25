import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'
import { Dumbbell, Trophy, Camera, Sparkles } from 'lucide-react'
import { useAuth } from '../AuthProvider'
import { Button } from '@/components/ui/button'
import { FullScreenSpinner } from '@/components/layout/FullScreenSpinner'

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path
        fill="currentColor"
        d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.9 1.5l2.6-2.6C16.9 3.1 14.7 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z"
      />
    </svg>
  )
}

export function LoginPage() {
  const { t } = useTranslation('auth')
  const { status, error, signInWithGoogle } = useAuth()

  if (status === 'loading' || status === 'checking') return <FullScreenSpinner />
  if (status === 'ready') return <Navigate to="/" replace />
  if (status === 'onboarding') return <Navigate to="/onboarding" replace />
  if (status === 'blocked') return <Navigate to="/denied" replace />

  const features = [
    { icon: Dumbbell, key: 'features.workouts' },
    { icon: Trophy, key: 'features.leaderboard' },
    { icon: Camera, key: 'features.photos' },
    { icon: Sparkles, key: 'features.ai' },
  ] as const

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-between px-6 pt-safe pb-safe">
      <div className="flex flex-1 flex-col justify-center gap-8">
        <div className="space-y-3 text-center">
          <div className="mx-auto flex size-20 items-center justify-center rounded-3xl bg-brand-500/15 text-brand-400">
            <Dumbbell className="size-10" aria-hidden />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-slate-400">{t('subtitle')}</p>
        </div>
        <ul className="space-y-3">
          {features.map(({ icon: Icon, key }) => (
            <li key={key} className="flex items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-slate-300">
              <Icon className="size-5 shrink-0 text-brand-400" aria-hidden />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-3 pb-6">
        {error && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {t('error', { message: error })}
          </p>
        )}
        <Button size="lg" className="w-full gap-3" onClick={() => void signInWithGoogle()}>
          <GoogleIcon />
          {t('signInWithGoogle')}
        </Button>
        <p className="text-center text-xs text-slate-500">{t('privacyNote')}</p>
      </div>
    </div>
  )
}
