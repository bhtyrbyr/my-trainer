import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { clampStep, stepFromScroll, type TourStep } from '../logic'
import { TourVisual } from './TourVisuals'

type Props = {
  steps: TourStep[]
  /** "Geç / Skip": close the tour where the user is */
  onSkip: () => void
  /** "Başlayalım" on the last step */
  onDone: () => void
  initialStep?: number
}

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Full-screen first-run tour. Slides sit on a native scroll-snap track (swipe works like any iOS
 * pager); Next/Back, arrow keys and the dots drive the same track. Only the active slide is
 * reachable by keyboard and screen readers (inert on the rest).
 */
export function Tour({ steps, onSkip, onDone, initialStep = 0 }: Props) {
  const { t } = useTranslation('tour')
  const titleId = useId()
  const track = useRef<HTMLDivElement>(null)
  const count = steps.length
  const [index, setIndex] = useState(() => clampStep(initialStep, count))
  const last = index === count - 1

  const go = useCallback(
    (to: number) => {
      const el = track.current
      const n = clampStep(to, count)
      setIndex(n)
      el?.scrollTo({ left: n * el.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' })
    },
    [count],
  )

  // open on the initial slide without animating; keep the slide in place when the viewport resizes
  const indexRef = useRef(index)
  indexRef.current = index
  useLayoutEffect(() => {
    const el = track.current
    if (!el) return
    const snap = () => {
      el.scrollLeft = indexRef.current * el.clientWidth
    }
    snap()
    window.addEventListener('resize', snap)
    return () => window.removeEventListener('resize', snap)
  }, [])

  const onScroll = () => {
    const el = track.current
    if (el) setIndex(stepFromScroll(el.scrollLeft, el.clientWidth, count))
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(index + 1)
    else if (e.key === 'ArrowLeft') go(index - 1)
    else return
    e.preventDefault()
  }

  // the slide's title takes focus on change, so VoiceOver reads the new step
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    document.getElementById(`${titleId}-${index}`)?.focus({ preventScroll: true })
  }, [index, titleId])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('label')}
      onKeyDown={onKeyDown}
      className="bg-atmosphere fixed inset-0 z-50 flex flex-col bg-bg"
    >
      <header className="pt-safe">
        <div className="mx-auto flex h-14 w-full max-w-md items-center justify-between pl-5 pr-2">
          <ol className="flex items-center gap-1.5" aria-label={t('stepOf', { n: index + 1, total: count })}>
            {steps.map((s, i) => (
              <li key={s} className="flex">
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-label={t('goTo', { n: i + 1 })}
                  aria-current={i === index ? 'step' : undefined}
                  // a 44pt-tall hit area around a 6pt dot
                  className="group -my-4 flex h-11 items-center"
                >
                  <span
                    className={cn(
                      'block h-1.5 rounded-full motion-safe:transition-[width,background-color] motion-safe:duration-200',
                      i === index
                        ? 'w-5 bg-volt'
                        : i < index
                          ? 'w-1.5 bg-ink-muted'
                          : 'w-1.5 bg-line-strong group-hover:bg-ink-faint',
                    )}
                  />
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={onSkip}
            className="touch-target rounded-[var(--radius-button)] px-3 text-[15px] font-medium text-ink-muted hover:text-ink"
          >
            {t('skip')}
          </button>
        </div>
      </header>

      <div
        ref={track}
        onScroll={onScroll}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {steps.map((step, i) => (
          <section
            key={step}
            aria-roledescription={t('slide')}
            aria-labelledby={`${titleId}-${i}`}
            inert={i !== index}
            className="flex w-full shrink-0 snap-center snap-always"
          >
            <div className="mx-auto flex h-full w-full max-w-md flex-col px-5">
              <div className="flex min-h-0 flex-1 items-center pt-1">
                <TourVisual step={step} />
              </div>
              <div className="pb-2 pt-7">
                <p className="eyebrow flex gap-2">
                  <span className="tabular text-volt">{String(i + 1).padStart(2, '0')}</span>
                  <span>{t(`steps.${step}.eyebrow`)}</span>
                </p>
                <h2
                  id={`${titleId}-${i}`}
                  tabIndex={-1}
                  className="display mt-2.5 text-[30px] leading-[1.06] outline-none"
                >
                  {t(`steps.${step}.title`)}
                </h2>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">{t(`steps.${step}.body`)}</p>
              </div>
            </div>
          </section>
        ))}
      </div>

      <footer className="pb-safe">
        <div className="mx-auto flex w-full max-w-md gap-3 px-5 pb-5 pt-3">
          {index > 0 && (
            <Button
              variant="secondary"
              size="lg"
              className="w-14 shrink-0 px-0"
              aria-label={t('back')}
              onClick={() => go(index - 1)}
            >
              <ChevronLeft className="size-6" aria-hidden />
            </Button>
          )}
          <Button size="lg" className="flex-1" onClick={() => (last ? onDone() : go(index + 1))}>
            {last ? t('start') : t('next')}
            <ArrowRight className="size-5" aria-hidden />
          </Button>
        </div>
      </footer>
    </div>
  )
}
