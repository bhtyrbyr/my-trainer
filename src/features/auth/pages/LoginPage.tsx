import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../AuthProvider'
import { Button } from '@/components/ui/button'
import { FullScreenSpinner } from '@/components/layout/FullScreenSpinner'
import { useReducedMotion } from '@/lib/motion'

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

/** public/login/{n}.webp, Unsplash License; order tells a story: start, run, climb, lift, rise, arrive. */
const SLIDES = [1, 2, 3, 4, 5, 6, 7] as const
const SLIDE_MS = 6500

/**
 * Point of view: a film opening, not a form. Full-bleed photos cross-fade with a slow push-in; one
 * colour grade unifies them; the image dissolves into the page colour (radial + linear) right above
 * the caption and the Google button, which stay in the thumb zone. Always dark (`scope-dark`), even
 * in the light theme, because the photos are. Reduced motion: no auto-advance and no zoom; swipe still
 * works.
 */
export function LoginPage() {
  const { t } = useTranslation(['auth', 'legal'])
  const { status, error, signInWithGoogle } = useAuth()
  const reduced = useReducedMotion()
  const [index, setIndex] = useState(0)
  // images mount lazily: the current one and the next, so the first paint loads one photo
  const [loadedUpTo, setLoadedUpTo] = useState(1)
  const touchX = useRef<number | null>(null)

  useEffect(() => {
    setLoadedUpTo((n) => Math.max(n, index + 1))
  }, [index])

  useEffect(() => {
    if (reduced) return
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % SLIDES.length), SLIDE_MS)
    return () => window.clearTimeout(id)
  }, [index, reduced])

  if (status === 'loading' || status === 'checking') return <FullScreenSpinner />
  if (status === 'ready') return <Navigate to="/" replace />
  if (status === 'onboarding') return <Navigate to="/onboarding" replace />
  if (status === 'pending' || status === 'rejected') return <Navigate to="/pending" replace />
  if (status === 'blocked') return <Navigate to="/denied" replace />

  const go = (step: number) => setIndex((i) => (i + step + SLIDES.length) % SLIDES.length)
  const n = SLIDES[index]

  return (
    <div
      className="scope-dark relative min-h-dvh overflow-hidden bg-bg text-ink"
      onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const start = touchX.current
        const end = e.changedTouches[0]?.clientX
        touchX.current = null
        if (start == null || end == null || Math.abs(end - start) < 40) return
        go(end < start ? 1 : -1)
      }}
    >
      {/* Photos */}
      <div aria-hidden className="absolute inset-0">
        {SLIDES.map((s, i) =>
          i <= loadedUpTo ? (
            <img
              key={s}
              src={`/login/${s}.webp`}
              alt=""
              decoding="async"
              fetchPriority={i === 0 ? 'high' : 'low'}
              className={`login-photo absolute inset-0 size-full object-cover ${i === index ? 'is-active' : ''}`}
            />
          ) : null,
        )}
        {/* colour grade: one olive tint across all photos */}
        <div className="absolute inset-0 bg-[oklch(30%_0.06_125)] mix-blend-soft-light" />
        {/* status-bar scrim, then the dissolve into the page above the action zone */}
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-bg/70 to-transparent" />
        <div className="login-dissolve absolute inset-0" />
      </div>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-safe pb-safe lg:max-w-lg">
        <p className="rise-in flex items-center gap-2.5 pt-5" style={{ '--i': 0 } as React.CSSProperties}>
          <img src="/favicon.svg" alt="" className="size-8 rounded-[8px] ring-1 ring-line" />
          <span className="display text-[20px] tracking-[-0.03em] text-ink">{t('eyebrow')}</span>
        </p>

        <div className="flex-1" />

        {/* Caption: re-keyed per slide so it rises in with the new photo; fixed height, no layout jump */}
        <div className="flex min-h-[138px] flex-col justify-end">
          <div key={n} className="rise-in">
            <h1 className="display text-[clamp(32px,9.5vw,42px)] leading-[1.02] text-ink">
              {t(`slides.${n}.title`)}
            </h1>
            <p className="mt-3 max-w-[34ch] text-[15.5px] leading-relaxed text-ink-muted">
              {t(`slides.${n}.body`)}
            </p>
          </div>
        </div>

        {/* Action: thumb zone */}
        <div className="mt-6 space-y-3 pb-5">
          {error && (
            <p
              role="alert"
              className="hairline rounded-[var(--radius-input)] bg-danger/10 px-4 py-3 text-sm text-danger"
            >
              {t('error', { message: error })}
            </p>
          )}
          <Button
            size="lg"
            className="w-full justify-between pl-5 pr-2"
            onClick={() => void signInWithGoogle()}
          >
            <span>{t('signInWithGoogle')}</span>
            <span className="flex size-10 items-center justify-center rounded-[10px] bg-volt-ink/15 text-volt-ink">
              <GoogleGlyph />
            </span>
          </Button>
          <p className="px-1 text-center text-[11.5px] leading-snug text-ink-faint">
            {t('privacyNote')}{' '}
            <Link
              to="/privacy"
              className="font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
            >
              {t('legal:notice.openFull')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
