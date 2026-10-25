import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { Stepper } from '@/features/workouts'
import { useBodyFormat } from '../format'
import { useSetTargetWeight } from '../hooks'

type Props = { open: boolean; current: number | null; suggestion: number | null; onClose: () => void }

/** Bottom sheet for the private goal weight. */
export function TargetSheet({ open, current, suggestion, onClose }: Props) {
  const { t } = useTranslation('body')
  const f = useBodyFormat()
  const setTarget = useSetTargetWeight()
  const [value, setValue] = useState<number | null>(current ?? suggestion ?? 70)

  useEffect(() => {
    if (open) setValue(current ?? suggestion ?? 70)
  }, [open, current, suggestion])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  const save = (kg: number | null) => setTarget.mutate(kg, { onSuccess: onClose })

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center lg:items-center" role="presentation">
      <button type="button" aria-label={t('actions.cancel')} className="absolute inset-0 bg-bg/70 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('targetSheet.title')}
        className="rise-in hairline relative w-full max-w-md rounded-t-[var(--radius-sheet)] bg-surface px-5 pb-safe pt-6 lg:rounded-[var(--radius-sheet)] lg:pb-0"
      >
        <h2 className="display text-[24px]">{t('targetSheet.title')}</h2>
        <p className="mt-1.5 text-[13px] leading-snug text-ink-muted">{t('targetSheet.hint')}</p>
        <Stepper
          label={t('sheet.weight')}
          value={value}
          onChange={setValue}
          step={0.5}
          min={20}
          max={400}
          decimal
          unit={t('units.kg')}
          format={f.num}
          decLabel={t('quick.weightDec')}
          incLabel={t('quick.weightInc')}
          className="mt-6 [&>label]:sr-only"
        />
        <ErrorNote error={setTarget.error} className="mt-4" />
        <div className="mt-6 grid gap-2 pb-5">
          <Button size="lg" disabled={value == null || setTarget.isPending} onClick={() => save(value)}>
            {setTarget.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
            {t('targetSheet.save')}
          </Button>
          {current != null && (
            <Button size="lg" variant="ghost" disabled={setTarget.isPending} onClick={() => save(null)}>
              {t('targetSheet.clear')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
