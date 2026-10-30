import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Outlet, useNavigate } from 'react-router-dom'
import { HeartPulse, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { FullScreenSpinner } from '@/components/layout/FullScreenSpinner'
import { useAcknowledgeNotice, useConsents, useGrantHealthConsent } from '../hooks'
import { NoticeContent } from './NoticeContent'

/**
 * App-wide: until the current privacy-notice version is acknowledged, show it instead of the app
 * (existing users after a notice update; new users acknowledge it during onboarding).
 */
export function NoticeGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation('legal')
  const consents = useConsents()
  const ack = useAcknowledgeNotice()
  const [adult, setAdult] = useState(false)
  if (consents.isLoading) return <FullScreenSpinner />
  // a failed read must not lock people out of their own data; the gate shows again next time
  if (consents.noticeAcked || consents.isError) return <>{children}</>
  return (
    <div className="bg-atmosphere min-h-dvh">
      <div className="mx-auto max-w-2xl px-5 pb-40 pt-safe">
        <div className="rise-in mt-8 hairline rounded-[var(--radius-card)] bg-surface px-4 py-3.5">
          <p className="text-[15px] font-semibold">{t('ack.gateTitle')}</p>
          <p className="mt-1 text-[13px] leading-snug text-ink-muted">{t('ack.gateBody')}</p>
        </div>
        <div className="mt-8">
          <NoticeContent />
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-bg via-bg/95 to-bg/0 px-5 pb-safe pt-8">
        <div className="mx-auto max-w-md space-y-2 pb-5">
          {!consents.adult && (
            <label className="flex min-h-11 items-center gap-3 px-1 text-[14px] text-ink">
              <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="size-5 shrink-0 accent-[var(--color-volt)]" />
              {t('ack.adult')}
            </label>
          )}
          <ErrorNote error={ack.error} />
          <Button size="lg" className="w-full" disabled={ack.isPending || (!consents.adult && !adult)} onClick={() => ack.mutate({ adult: !consents.adult })}>
            {ack.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
            {t('ack.gateConfirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** The explicit-consent screen for health data (KVKK art. 6). */
export function HealthConsentScreen({ onLater }: { onLater: () => void }) {
  const { t } = useTranslation('legal')
  const grant = useGrantHealthConsent()
  return (
    <section className="rise-in mx-auto max-w-md space-y-5 py-4">
      <div>
        <HeartPulse className="size-8 text-volt" aria-hidden />
        <p className="eyebrow mt-4">{t('health.eyebrow')}</p>
        <h1 className="display mt-2 text-[28px] leading-tight">{t('health.title')}</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">{t('health.body')}</p>
      </div>
      <blockquote className="hairline rounded-[var(--radius-card)] bg-surface px-4 py-4 text-[14px] leading-relaxed text-ink">
        {t('health.statement')}
      </blockquote>
      <p className="text-[13px] leading-snug text-ink-faint">
        {t('health.withdrawNote')}{' '}
        <Link to="/privacy" className="font-medium text-ink-muted underline underline-offset-2 hover:text-ink">
          {t('notice.openFull')}
        </Link>
      </p>
      <ErrorNote error={grant.error} />
      <div className="space-y-2">
        <Button size="lg" className="w-full" disabled={grant.isPending} onClick={() => grant.mutate()}>
          {grant.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
          {t('health.agree')}
        </Button>
        <Button size="lg" variant="ghost" className="w-full" onClick={onLater}>
          {t('health.later')}
        </Button>
      </div>
    </section>
  )
}

/** Layout route around the health sections: consent first, then the page. */
export function HealthGate() {
  const consents = useConsents()
  const navigate = useNavigate()
  if (consents.isLoading) return <FullScreenSpinner />
  if (consents.health) return <Outlet />
  return (
    <div className="px-5 pt-safe">
      <HealthConsentScreen onLater={() => navigate('/track')} />
    </div>
  )
}
