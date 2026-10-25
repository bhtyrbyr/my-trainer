import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../AuthProvider'
import { Button } from '@/components/ui/button'
import { FullScreenSpinner } from '@/components/layout/FullScreenSpinner'

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="currentColor"
        d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.9 1.5l2.6-2.6C16.9 3.1 14.7 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z"
      />
    </svg>
  )
}

/**
 * Point of view: a performance instrument, not a form. Editorial scale on the headline,
 * numbers as imagery for the proof points, one volt accent, CTA anchored in the thumb zone.
 */
export function LoginPage() {
  const { t } = useTranslation('auth')
  const { status, error, signInWithGoogle } = useAuth()

  if (status === 'loading' || status === 'checking') return <FullScreenSpinner />
  if (status === 'ready') return <Navigate to="/" replace />
  if (status === 'onboarding') return <Navigate to="/onboarding" replace />
  if (status === 'blocked') return <Navigate to="/denied" replace />

  const proofs = [
    { value: '1500', unit: 'GIF', key: 'proof.exercises' },
    { value: 'E2E', unit: '', key: 'proof.photos' },
    { value: '+300', unit: t('proof.pointsUnit'), key: 'proof.points' },
  ] as const

  return (
    <div className="bg-atmosphere mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-safe pb-safe lg:max-w-5xl lg:flex-row lg:items-center lg:gap-16 lg:px-12">
      {/* Hero */}
      <div className="flex flex-1 flex-col justify-end pt-10 lg:justify-center">
        <p className="eyebrow rise-in" style={{ '--i': 0 } as React.CSSProperties}>
          {t('eyebrow')}
        </p>
        <h1 className="display rise-in mt-4 text-[56px] text-ink lg:text-[88px]" style={{ '--i': 1 } as React.CSSProperties}>
          {t('headline.a')}
          <br />
          <span className="text-volt">{t('headline.b')}</span>
        </h1>
        <p className="rise-in mt-5 max-w-[34ch] text-[17px] leading-relaxed text-ink-muted" style={{ '--i': 2 } as React.CSSProperties}>
          {t('subtitle')}
        </p>

        {/* Proof points: numbers as imagery */}
        <ul className="rise-in mt-10 divide-y divide-line border-y border-line" style={{ '--i': 3 } as React.CSSProperties}>
          {proofs.map((p) => (
            <li key={p.key} className="flex items-center gap-4 py-3.5">
              <span className="flex w-[96px] shrink-0 flex-col leading-none">
                <span className="display tabular text-[28px] text-ink">{p.value}</span>
                {p.unit && <span className="mt-1 text-[11px] font-medium tracking-[0.08em] text-ink-faint uppercase">{p.unit}</span>}
              </span>
              <span className="text-[15px] leading-snug text-ink-muted">{t(p.key)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Action: thumb zone on phone, right column on desktop */}
      <div className="rise-in mt-10 space-y-4 pb-6 lg:w-[380px] lg:pb-0" style={{ '--i': 4 } as React.CSSProperties}>
        {error && (
          <p role="alert" className="hairline rounded-[var(--radius-input)] bg-danger/10 px-4 py-3 text-sm text-danger">
            {t('error', { message: error })}
          </p>
        )}
        <Button size="lg" className="w-full justify-between pl-5 pr-2" onClick={() => void signInWithGoogle()}>
          <span>{t('signInWithGoogle')}</span>
          <span className="flex size-10 items-center justify-center rounded-[10px] bg-volt-ink/15 text-volt-ink">
            <GoogleGlyph />
          </span>
        </Button>
        <p className="px-1 text-center text-[12px] leading-relaxed text-ink-faint">{t('privacyNote')}</p>
      </div>
    </div>
  )
}
