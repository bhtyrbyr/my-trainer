import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { Stepper } from '@/features/workouts'

type Props = {
  open: boolean
  kcal: number | null
  protein: number | null
  pending: boolean
  error: unknown
  onSave: (goals: { daily_kcal: number | null; daily_protein_g: number | null }) => void
  onClose: () => void
}

/** Daily kcal and protein goals (user_settings). Workout energy is never added to them. */
export function GoalsSheet({ open, kcal, protein, pending, error, onSave, onClose }: Props) {
  const { t } = useTranslation('nutrition')
  const [k, setK] = useState<number | null>(kcal ?? 2000)
  const [p, setP] = useState<number | null>(protein ?? 120)

  useEffect(() => {
    if (open) {
      setK(kcal ?? 2000)
      setP(protein ?? 120)
    }
  }, [open, kcal, protein])

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
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('goals.title')}
        className="rise-in hairline relative w-full max-w-md rounded-t-[var(--radius-sheet)] bg-surface px-5 pb-safe pt-6 lg:rounded-[var(--radius-sheet)] lg:pb-0"
      >
        <h2 className="display text-[24px]">{t('goals.title')}</h2>
        <p className="mt-1.5 text-[13px] leading-snug text-ink-muted">{t('goals.hint')}</p>
        <div className="mt-6 space-y-6">
          <Stepper
            label={t('goals.kcal')}
            value={k}
            onChange={setK}
            step={50}
            min={500}
            max={10000}
            unit={t('units.kcal')}
            decLabel={t('goals.kcalDec')}
            incLabel={t('goals.kcalInc')}
          />
          <Stepper
            label={t('goals.protein')}
            value={p}
            onChange={setP}
            step={5}
            min={0}
            max={1000}
            unit={t('units.g')}
            decLabel={t('goals.proteinDec')}
            incLabel={t('goals.proteinInc')}
          />
        </div>
        <ErrorNote error={error} className="mt-4" />
        <div className="mt-6 grid gap-2 pb-5">
          <Button size="lg" disabled={pending} onClick={() => onSave({ daily_kcal: k, daily_protein_g: p })}>
            {pending && <Loader2 className="size-5 animate-spin" aria-hidden />}
            {t('goals.save')}
          </Button>
          {(kcal != null || protein != null) && (
            <Button size="lg" variant="ghost" disabled={pending} onClick={() => onSave({ daily_kcal: null, daily_protein_g: null })}>
              {t('goals.clear')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
