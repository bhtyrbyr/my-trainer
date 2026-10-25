import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { cn } from '@/lib/utils'
import { useLogCardio, useWeightUnit } from '../hooks'
import { CARDIO_ACTIVITIES, formatClock, paceSecPerKm, type CardioActivity } from '../logic'
import { cardioInput, type FinishSummary } from '../schema'
import { Stepper } from './Stepper'

/**
 * Cardio in three taps: activity, minutes, save. Distance and heart rate are optional and quiet.
 * After saving, the sheet turns into a small receipt with the points earned.
 */
export function CardioSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('workouts')
  const { formatNumber } = useWeightUnit()
  const log = useLogCardio()
  const [activity, setActivity] = useState<CardioActivity>('run')
  const [minutes, setMinutes] = useState<number | null>(30)
  const [distance, setDistance] = useState<number | null>(null)
  const [hr, setHr] = useState<number | null>(null)
  const [done, setDone] = useState<FinishSummary | null>(null)

  if (!open) return null

  const parsed = cardioInput.safeParse({ activity, minutes: minutes ?? 0, distanceKm: distance, avgHr: hr })

  const close = () => {
    setDone(null)
    log.reset()
    onClose()
  }

  const submit = () => {
    if (!parsed.success) return
    log.mutate(parsed.data, { onSuccess: setDone })
  }

  const pace = done ? null : paceSecPerKm((minutes ?? 0) * 60, distance ? distance * 1000 : null)

  return (
    <div role="dialog" aria-modal="true" aria-label={t('cardio.title')} className="fixed inset-0 z-50 flex flex-col bg-bg pt-safe pb-safe">
      <header className="flex h-14 items-center justify-between gap-2 border-b border-line px-4">
        <h2 className="text-lg font-bold tracking-tight">{t('cardio.title')}</h2>
        <Button variant="ghost" size="icon" aria-label={t('common.close')} onClick={close}>
          <X className="size-5" aria-hidden />
        </Button>
      </header>

      {done ? (
        <div className="bg-atmosphere flex flex-1 flex-col justify-center px-6">
          <p className="eyebrow rise-in text-volt">{t('cardio.saved')}</p>
          <p className="display tabular rise-in mt-4 text-[88px] leading-none text-volt" style={{ ['--i' as string]: 1 }}>
            +{done.points_awarded}
          </p>
          <p className="rise-in mt-2 text-sm text-ink-muted" style={{ ['--i' as string]: 2 }}>
            {done.points_awarded > 0 ? t('summary.pointsLabel') : t('summary.noPoints')}
          </p>
          <p className="display tabular rise-in mt-10 text-[34px]" style={{ ['--i' as string]: 3 }}>
            {formatClock(done.duration_sec)}
            <span className="ml-2 text-base font-medium text-ink-faint">{t(`cardio.activity.${activity}`)}</span>
          </p>
          <Button size="lg" className="mt-12 w-full" onClick={close}>
            {t('common.done')}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex-1 space-y-8 overflow-y-auto px-4 py-5">
            <fieldset>
              <legend className="eyebrow mb-2">{t('cardio.activityLabel')}</legend>
              <div className="grid grid-cols-4 gap-2">
                {CARDIO_ACTIVITIES.map((a) => (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={activity === a}
                    onClick={() => setActivity(a)}
                    className={cn(
                      'h-12 rounded-[var(--radius-input)] px-1 text-[14px] font-semibold transition-colors',
                      activity === a ? 'inner-glow bg-volt text-volt-ink' : 'hairline bg-surface text-ink-muted hover:text-ink',
                    )}
                  >
                    {t(`cardio.activity.${a}`)}
                  </button>
                ))}
              </div>
            </fieldset>

            <Stepper
              label={t('cardio.duration')}
              value={minutes}
              onChange={setMinutes}
              step={5}
              min={1}
              max={600}
              unit={t('units.min')}
              decLabel={t('cardio.durationDec')}
              incLabel={t('cardio.durationInc')}
            />

            <div className="grid grid-cols-1 gap-6 min-[380px]:grid-cols-2 min-[380px]:gap-3">
              <Stepper
                size="sm"
                label={t('cardio.distance')}
                value={distance}
                onChange={setDistance}
                step={0.5}
                min={0}
                max={1000}
                decimal
                unit={t('units.km')}
                format={formatNumber}
                decLabel={t('cardio.distanceDec')}
                incLabel={t('cardio.distanceInc')}
              />
              <Stepper
                size="sm"
                label={t('cardio.hr')}
                value={hr}
                onChange={setHr}
                step={5}
                min={30}
                max={250}
                unit={t('units.bpm')}
                decLabel={t('cardio.hrDec')}
                incLabel={t('cardio.hrInc')}
              />
            </div>
            {pace !== null && (
              <p className="tabular text-sm text-ink-muted">
                {t('cardio.pace')} <span className="font-semibold text-ink">{formatClock(pace)}</span> /{t('units.km')}
              </p>
            )}
            <ErrorNote error={log.error} />
          </div>
          <div className="border-t border-line px-4 pt-3 pb-3">
            <Button size="lg" className="w-full" disabled={!parsed.success || log.isPending} onClick={submit}>
              {log.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
              {t('cardio.save')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
