import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { addDays, format, parseISO } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { ArrowLeft, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { useUserSettings } from '@/features/settings/hooks'
import { useBurnedOn } from '@/features/workouts'
import { toLocalDateISO } from '@/lib/dates'
import { AddFoodSheet } from '../components/AddFoodSheet'
import { EnergyLedger } from '../components/EnergyLedger'
import { EntrySheet } from '../components/EntrySheet'
import { GoalsSheet } from '../components/GoalsSheet'
import { MealList } from '../components/MealList'
import { useMeals } from '../hooks'
import { slotForTime, totalsOf } from '../logic'
import { useIsNutritionPreview } from '../previewContext'
import type { MealEntry, MealSlot } from '../types'

type Props = { preview?: { goals: { kcal: number | null; protein: number | null }; burned: { kcal: number; sessions: number } } }

/**
 * Nutrition. Point of view: the day's ledger. Eaten and burned sit side by side and are never
 * netted; the meals below are one ruled list. Adding food is one button in the thumb zone.
 */
export function NutritionPage({ preview }: Props) {
  const { t, i18n } = useTranslation('nutrition')
  const isPreview = useIsNutritionPreview()
  const [params, setParams] = useSearchParams()
  const today = toLocalDateISO()
  const dayParam = params.get('day')
  const day = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) && dayParam <= today ? dayParam : today
  const meals = useMeals(day)
  const burned = useBurnedOn(day, preview?.burned)
  const { settings, updateSettings } = useUserSettings()
  const goalKcal = preview ? preview.goals.kcal : (settings?.daily_kcal ?? null)
  const goalProtein = preview ? preview.goals.protein : (settings?.daily_protein_g ?? null)

  const [addSlot, setAddSlot] = useState<MealSlot | null>(null)
  const [editing, setEditing] = useState<MealEntry | null>(null)
  const [goalsOpen, setGoalsOpen] = useState(false)

  const entries = useMemo(() => meals.data ?? [], [meals.data])
  const totals = useMemo(() => totalsOf(entries), [entries])
  const locale = i18n.resolvedLanguage === 'en' ? enUS : tr
  const yesterday = toLocalDateISO(addDays(new Date(), -1))
  const dayLabel = day === today ? t('day.today') : day === yesterday ? t('day.yesterday') : format(parseISO(day), 'd MMMM, EEE', { locale })
  const shift = (n: number) => {
    const next = toLocalDateISO(addDays(parseISO(day), n))
    setParams(next === today ? {} : { day: next }, { replace: true })
  }

  return (
    <PageShell
      title={t('title')}
      leading={
        <div className="flex items-center gap-1">
          <Link
            to={isPreview ? '/__dev/track' : '/track'}
            aria-label={t('back')}
            className="-ml-2 flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <span className="text-lg font-bold tracking-tight">{t('title')}</span>
        </div>
      }
    >
      <div className="mx-auto max-w-2xl space-y-5 pb-6">
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label={t('day.prev')}
            onClick={() => shift(-1)}
            className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <h2 className="display text-[22px] capitalize" aria-live="polite">
            {dayLabel}
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

        <ErrorNote error={meals.error ?? burned.error} />
        {meals.isLoading ? (
          <div className="h-[210px] animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none" aria-busy="true" />
        ) : (
          <EnergyLedger totals={totals} goalKcal={goalKcal} goalProtein={goalProtein} burned={burned.data} onGoals={() => setGoalsOpen(true)} />
        )}

        <Button size="lg" className="w-full" onClick={() => setAddSlot(day === today ? slotForTime(new Date()) : 'snack')}>
          <Plus className="size-5" aria-hidden />
          {t('add')}
        </Button>

        {!meals.isLoading && <MealList entries={entries} onAdd={setAddSlot} onOpen={setEditing} />}
        {!meals.isLoading && entries.length === 0 && <p className="px-1 text-center text-[13px] text-ink-faint">{t('emptyDay')}</p>}
      </div>

      <AddFoodSheet open={addSlot !== null} day={day} slot={addSlot ?? 'snack'} onClose={() => setAddSlot(null)} />
      <EntrySheet entry={editing} onClose={() => setEditing(null)} />
      <GoalsSheet
        open={goalsOpen}
        kcal={goalKcal}
        protein={goalProtein}
        pending={updateSettings.isPending}
        error={updateSettings.error}
        onSave={(g) => (preview ? setGoalsOpen(false) : updateSettings.mutate(g, { onSuccess: () => setGoalsOpen(false) }))}
        onClose={() => setGoalsOpen(false)}
      />
    </PageShell>
  )
}
