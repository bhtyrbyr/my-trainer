import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { formatClock, restProgress, restRemainingSec, shouldAlertRestEnd } from '../logic'
import { restEndAlert } from '../restAlert'
import { useNow } from '../sessionHooks'

type Props = {
  endsAt: number
  totalSec: number
  /** "up next" block under the clock */
  next: ReactNode
  onAdd: (sec: number) => void
  onSkip: () => void
  /** called once when the countdown reaches zero (alert already fired if the end was fresh) */
  onEnd: () => void
}

/**
 * Rest takeover. The clock is the only thing on screen that matters, so it gets the full width at display
 * size; the bar drains underneath; skip sits under the thumb. Time is always derived from `endsAt`.
 */
export function RestTimer({ endsAt, totalSec, next, onAdd, onSkip, onEnd }: Props) {
  const { t } = useTranslation('workouts')
  const now = useNow(250)
  const remaining = restRemainingSec(endsAt, now)
  const progress = restProgress(endsAt, totalSec, now)
  const ended = useRef(false)

  useEffect(() => {
    ended.current = false
  }, [endsAt])

  useEffect(() => {
    if (remaining > 0 || ended.current) return
    ended.current = true
    if (shouldAlertRestEnd(endsAt, Date.now())) restEndAlert()
    onEnd()
  }, [remaining, endsAt, onEnd])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('rest.title')}
      className="bg-atmosphere fixed inset-0 z-[55] flex flex-col bg-bg pt-safe pb-safe"
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5">
        <p className="eyebrow mt-6 text-volt">{t('rest.title')}</p>

        <div className="flex flex-1 flex-col justify-center">
          <p
            role="timer"
            aria-live="off"
            aria-label={t('rest.remaining', { time: formatClock(remaining) })}
            className="display tabular text-center text-[128px] leading-none tracking-[-0.05em] text-ink"
          >
            {formatClock(remaining)}
          </p>
          <div className="mt-8 h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
            <div
              className="h-full rounded-full bg-volt transition-[width] duration-300 ease-linear motion-reduce:transition-none"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <p className="tabular mt-3 text-center text-[13px] text-ink-faint">{t('rest.of', { time: formatClock(totalSec) })}</p>
        </div>

        <div className="mb-6">{next}</div>

        <div className="mb-4 grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={() => onAdd(30)}>
            {t('rest.add30')}
          </Button>
          <Button size="lg" onClick={onSkip}>
            {t('rest.skip')}
          </Button>
        </div>
      </div>
    </div>
  )
}
