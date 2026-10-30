import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { useUnits } from '@/features/settings/useUnits'
import { Stepper } from '@/features/workouts'
import { roundToStep } from '@/lib/units'
import { useSetHeight } from '../hooks'

/** Bottom sheet for height (stored in cm, entered in the user's unit), used for the body mass index. Private to the user. */
export function HeightSheet({ open, current, onClose }: { open: boolean; current: number | null; onClose: () => void }) {
  const { t } = useTranslation('body')
  const u = useUnits()
  const setHeight = useSetHeight()
  const step = u.steps.height
  const [min, max] = u.lengthRange(100, 250, step)
  const shown = useCallback((cm: number) => roundToStep(u.cm(cm), step), [u, step])
  const [value, setValue] = useState<number | null>(shown(current ?? 175))

  // re-seed on open and when the unit arrives or changes
  useEffect(() => {
    if (open) setValue(shown(current ?? 175))
  }, [open, current, shown])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center lg:items-center" role="presentation">
      <button type="button" aria-label={t('actions.cancel')} className="absolute inset-0 bg-bg/70 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={t('height.title')} className="rise-in hairline relative w-full max-w-md rounded-t-[var(--radius-sheet)] bg-surface px-5 pb-safe pt-6 lg:rounded-[var(--radius-sheet)] lg:pb-0">
        <h2 className="display text-[24px]">{t('height.title')}</h2>
        <p className="mt-1.5 text-[13px] leading-snug text-ink-muted">{t('height.hint')}</p>
        <Stepper
          label={t('height.title')}
          value={value}
          onChange={setValue}
          step={step}
          min={min}
          max={max}
          decimal={u.length === 'in'}
          unit={u.lengthLabel}
          format={u.length === 'in' ? u.estimateValue : u.heightCm}
          decLabel={t('height.dec', { step: u.estimateValue(step), unit: u.lengthLabel })}
          incLabel={t('height.inc', { step: u.estimateValue(step), unit: u.lengthLabel })}
          className="mt-6 [&>label]:sr-only"
        />
        {u.length === 'in' && value != null && (
          <p className="tabular -mt-1 text-center text-[13px] text-ink-muted">{u.height(u.toCm(value))}</p>
        )}
        <ErrorNote error={setHeight.error} className="mt-4" />
        <div className="mt-6 grid gap-2 pb-5">
          <Button size="lg" disabled={value == null || setHeight.isPending} onClick={() => value != null && setHeight.mutate(u.toCm(value), { onSuccess: onClose })}>
            {setHeight.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
            {t('height.save')}
          </Button>
          <Button size="lg" variant="ghost" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
        </div>
      </div>
    </div>
  )
}
