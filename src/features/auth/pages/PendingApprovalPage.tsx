import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'
import { Hourglass, RefreshCw, ShieldX } from 'lucide-react'
import { useAuth } from '../AuthProvider'
import { routeFor } from '../routeFor'
import { Button } from '@/components/ui/button'
import { avatarUrl } from '@/features/profile/api'

/**
 * Waiting room after onboarding. Polls the profile every 20s so approval flips the user in
 * without a reload. Point of view: calm, honest status card; one quiet action (sign out).
 */
export function PendingApprovalPage({ preview }: { preview?: 'pending' | 'rejected' }) {
  const { t } = useTranslation('auth')
  const auth = useAuth()
  const { profile, refreshProfile, signOut } = auth
  const status = preview ?? auth.status
  const rejected = status === 'rejected'

  useEffect(() => {
    if (status !== 'pending') return
    const id = window.setInterval(() => void refreshProfile(), 20_000)
    return () => window.clearInterval(id)
  }, [status, refreshProfile])

  if (status !== 'pending' && status !== 'rejected') {
    const to = routeFor(status)
    if (to && to !== '/pending') return <Navigate to={to} replace />
    if (status === 'ready') return <Navigate to="/" replace />
  }

  const avatar = avatarUrl(profile?.avatar_path, profile?.updated_at)

  return (
    <div className="bg-atmosphere mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-safe pb-safe">
      <div className="flex flex-1 flex-col justify-center gap-8">
        <div className="hairline rise-in flex items-center gap-4 rounded-[var(--radius-card)] bg-surface p-4" style={{ '--i': 0 } as React.CSSProperties}>
          {avatar ? <img src={avatar} alt="" className="size-14 rounded-full object-cover" /> : <span className="size-14 rounded-full bg-raised" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold">{profile?.display_name}</p>
            <p className="truncate text-sm text-ink-muted">@{profile?.username}</p>
          </div>
          <span
            className={
              'flex size-10 items-center justify-center rounded-full ' +
              (rejected ? 'bg-danger/15 text-danger' : 'bg-volt/15 text-volt')
            }
          >
            {rejected ? <ShieldX className="size-5" aria-hidden /> : <Hourglass className="size-5" aria-hidden />}
          </span>
        </div>

        <div className="rise-in space-y-3" style={{ '--i': 1 } as React.CSSProperties}>
          <p className="eyebrow">{rejected ? t('pending.rejectedEyebrow') : t('pending.eyebrow')}</p>
          <h1 className="display text-[36px] text-ink">{rejected ? t('pending.rejectedTitle') : t('pending.title')}</h1>
          <p className="max-w-[34ch] text-[16px] leading-relaxed text-ink-muted">
            {rejected ? t('pending.rejectedBody') : t('pending.body')}
          </p>
        </div>
      </div>

      <div className="rise-in space-y-3 pb-6" style={{ '--i': 2 } as React.CSSProperties}>
        {!rejected && (
          <Button variant="secondary" size="lg" className="w-full gap-2" onClick={() => void refreshProfile()}>
            <RefreshCw className="size-5" aria-hidden />
            {t('pending.refresh')}
          </Button>
        )}
        <Button variant="ghost" size="lg" className="w-full" onClick={() => void signOut()}>
          {t('signOut')}
        </Button>
      </div>
    </div>
  )
}
