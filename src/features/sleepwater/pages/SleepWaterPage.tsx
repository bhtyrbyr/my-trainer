import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { addDays, format, parseISO } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { useUserSettings } from '@/features/settings/hooks'
import { Stepper } from '@/features/workouts'
import { toLocalDateISO } from '@/lib/dates'
import { SleepCard } from '../components/SleepCard'
import { WaterCard } from '../components/WaterCard'
import { useIsSleepWaterPreview } from '../previewContext'
import { DEFAULT_WATER_GOAL } from '../types'

/** Sleep and water for one day: water first (logged all day long), then last night's sleep. */
export function SleepWaterPage() {
  const { t, i18n } = useTranslation('sleepwater')
  const locale = i18n.resolvedLanguage === 'en' ? enUS : tr
  const preview = useIsSleepWaterPreview()
  const [params, setParams] = useSearchParams()
  const today = toLocalDateISO()
  const dayParam = params.get('day')
  const day = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) && dayParam <= today ? dayParam : today
  const { settings, updateSettings } = useUserSettings()
  const goal = settings?.daily_water_ml ?? DEFAULT_WATER_GOAL
  const [goalOpen, setGoalOpen] = useState(false)

  const yesterday = toLocalDateISO(addDays(new Date(), -1))
  const label = day === today ? t('day.today') : day === yesterday ? t('day.yesterday') : format(parseISO(day), 'd MMMM, EEEE', { locale })
  const shift = (n: number) => {
    const next = toLocalDateISO(addDays(parseISO(day), n))
    setParams(next === today ? {} : { day: next }, { replace: true })
  }

  return (
    <PageShell
      title={t('title')}
      leading={
        <div className="flex items-center gap-1">
          <Link to={preview ? '/__dev/track' : '/track'} aria-label={t('back')} className="-ml-2 flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink">
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <span className="text-lg font-bold tracking-tight">{t('title')}</span>
        </div>
      }
    >
      <div className="mx-auto max-w-2xl space-y-5 pb-6">
        <div className="flex items-center justify-between">
          <button type="button" aria-label={t('day.prev')} onClick={() => shift(-1)} className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink">
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <h2 className="display text-[22px] capitalize" aria-live="polite">
            {label}
          </h2>
          <button
            type="button"
            aria-label={t('day.next')}
            disabled={day >= today}
            onClick={() => shift(1)}
            className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink disabled:opacity-30"
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
        <div className="space-y-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 lg:space-y-0">
          <WaterCard day={day} goal={goal} onGoal={() => setGoalOpen(true)} />
          <SleepCard day={day} />
        </div>
      </div>

      <GoalSheet
        open={goalOpen}
        value={goal}
        pending={updateSettings.isPending}
        error={updateSettings.error}
        onSave={(ml) => (preview ? setGoalOpen(false) : updateSettings.mutate({ daily_water_ml: ml }, { onSuccess: () => setGoalOpen(false) }))}
        onClose={() => setGoalOpen(false)}
      />
    </PageShell>
  )
}

function GoalSheet({ open, value, pending, error, onSave, onClose }: { open: boolean; value: number; pending: boolean; error: unknown; onSave: (ml: number) => void; onClose: () => void }) {
  const { t } = useTranslation('sleepwater')
  const [ml, setMl] = useState<number | null>(value)
  useEffect(() => {
    if (open) setMl(value)
  }, [open, value])
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
      <div role="dialog" aria-modal="true" aria-label={t('goalSheet.title')} className="rise-in hairline relative w-full max-w-md rounded-t-[var(--radius-sheet)] bg-surface px-5 pb-safe pt-6 lg:rounded-[var(--radius-sheet)] lg:pb-0">
        <h2 className="display text-[24px]">{t('goalSheet.title')}</h2>
        <p className="mt-1.5 text-[13px] leading-snug text-ink-muted">{t('goalSheet.hint')}</p>
        <Stepper
          label={t('goalSheet.title')}
          value={ml}
          onChange={setMl}
          step={250}
          min={500}
          max={10000}
          unit="ml"
          decLabel={t('goalSheet.dec')}
          incLabel={t('goalSheet.inc')}
          className="mt-6 [&>label]:sr-only"
        />
        <ErrorNote error={error} className="mt-4" />
        <div className="mt-6 grid gap-2 pb-5">
          <Button size="lg" disabled={ml == null || pending} onClick={() => ml != null && onSave(ml)}>
            {pending && <Loader2 className="size-5 animate-spin" aria-hidden />}
            {t('goalSheet.save')}
          </Button>
          <Button size="lg" variant="ghost" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
        </div>
      </div>
    </div>
  )
}
