import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { subDays } from 'date-fns'
import { Loader2, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { useUnits } from '@/features/settings/useUnits'
import { Stepper } from '@/features/workouts'
import { toLocalDateISO } from '@/lib/dates'
import { roundToStep } from '@/lib/units'
import { cn } from '@/lib/utils'
import { useDeleteBodyMetric, useSaveBodyMetric } from '../hooks'
import { latestMeasurements } from '../logic'
import { MEASURE_FIELDS, type BodyMetric, type BodyMetricInput, type MeasureField } from '../types'

/** Sensible first values when a circumference has never been logged (cm; shown in the user's unit). */
const FIRST_GUESS: Record<MeasureField, number> = { neck_cm: 38, waist_cm: 85, chest_cm: 100, hip_cm: 100, arm_cm: 33, thigh_cm: 56 }
const LIMITS: Record<MeasureField, [number, number]> = {
  neck_cm: [20, 80],
  waist_cm: [20, 300],
  chest_cm: [20, 300],
  hip_cm: [20, 300],
  arm_cm: [10, 150],
  thigh_cm: [10, 200],
}

type Props = {
  open: boolean
  day: string
  rows: BodyMetric[]
  lastWeight: number | null
  onClose: () => void
}

/** Full-screen entry for one day: weight and circumferences. Re-opening a logged day edits it. */
export function LogSheet({ open, day: initialDay, rows, lastWeight, onClose }: Props) {
  const { t } = useTranslation('body')
  const { weight: weightUnit, length: lengthUnit } = useUnits()
  const [day, setDay] = useState(initialDay)
  const today = toLocalDateISO()

  useEffect(() => {
    if (open) setDay(initialDay)
  }, [open, initialDay])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div role="dialog" aria-modal="true" aria-label={t('sheet.title')} className="fixed inset-0 z-50 flex flex-col bg-bg pt-safe pb-safe">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
        <h2 className="text-lg font-bold tracking-tight">{t('sheet.title')}</h2>
        <Button variant="ghost" size="icon" aria-label={t('actions.close')} onClick={onClose}>
          <X className="size-5" aria-hidden />
        </Button>
      </header>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-hidden">
        <label className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
          <span className="eyebrow">{t('sheet.date')}</span>
          <input
            type="date"
            value={day}
            max={today}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            className="tabular h-11 rounded-[var(--radius-input)] bg-surface px-3 text-[16px] text-ink outline-none hairline focus-visible:ring-2 focus-visible:ring-volt"
          />
        </label>
        <EntryForm key={`${day}:${weightUnit}:${lengthUnit}`} day={day} rows={rows} lastWeight={lastWeight} onDone={onClose} />
      </div>
    </div>
  )
}

function EntryForm({ day, rows, lastWeight, onDone }: { day: string; rows: BodyMetric[]; lastWeight: number | null; onDone: () => void }) {
  const { t } = useTranslation('body')
  const u = useUnits()
  const save = useSaveBodyMetric()
  const remove = useDeleteBodyMetric()
  const row = rows.find((r) => r.measured_on === day) ?? null
  const latest = latestMeasurements(rows)

  // form state is in the user's units; converted back to kg / cm only for the payload
  const kgShown = (kg: number | null) => (kg == null ? null : u.kg(kg, 'body'))
  const cmShown = (cm: number | null) => (cm == null ? null : u.cm(cm))
  const initialWeight = kgShown(row ? (row.weight_kg == null ? null : Number(row.weight_kg)) : lastWeight)
  const initialMeasures = Object.fromEntries(MEASURE_FIELDS.map((k) => [k, cmShown(row?.[k] == null ? null : Number(row[k]))])) as Record<MeasureField, number | null>
  const [weight, setWeight] = useState<number | null>(initialWeight)
  const [measures, setMeasures] = useState(initialMeasures)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const old = day < toLocalDateISO(subDays(new Date(), 2))

  const payload: BodyMetricInput = { measured_on: day }
  if (!row || weight !== initialWeight) payload.weight_kg = weight == null ? null : u.toKg(weight, 'body')
  for (const k of MEASURE_FIELDS) {
    const v = measures[k]
    if (v !== initialMeasures[k]) payload[k] = v == null ? null : u.toCm(v)
  }
  const weightStep = u.steps.body
  const [weightMin, weightMax] = u.weightRange(20, 400, weightStep)
  const lengthStep = u.steps.circumference
  const stepText = (step: number, unit: string) => ({ step: u.estimateValue(step), unit })
  const changed = Object.keys(payload).length > 1
  const empty = !row && weight == null && MEASURE_FIELDS.every((k) => measures[k] == null)
  const canSave = changed && !empty && !save.isPending

  const submit = () => {
    if (!canSave) return
    save.mutate(payload, { onSuccess: onDone })
  }

  return (
    <>
      <div className="flex-1 space-y-8 overflow-y-auto px-4 py-6">
        <section aria-label={t('sheet.weight')}>
          {weight == null ? (
            <div className="flex items-center justify-between">
              <span className="eyebrow">{t('sheet.weight')}</span>
              <Button variant="secondary" onClick={() => setWeight(kgShown(lastWeight ?? 70))}>
                {t('sheet.addWeight')}
              </Button>
            </div>
          ) : (
            <>
              <Stepper
                label={t('sheet.weight')}
                value={weight}
                onChange={setWeight}
                step={weightStep}
                min={weightMin}
                max={weightMax}
                decimal
                unit={u.weightLabel}
                format={u.bodyValue}
                decLabel={t('quick.weightDec', stepText(weightStep, u.weightLabel))}
                incLabel={t('quick.weightInc', stepText(weightStep, u.weightLabel))}
              />
              <button type="button" onClick={() => setWeight(null)} className="mt-1 h-11 text-[13px] font-medium text-ink-faint hover:text-ink">
                {t('sheet.removeWeight')}
              </button>
            </>
          )}
        </section>

        <section aria-labelledby="sheet-measures">
          <h3 id="sheet-measures" className="eyebrow mb-1">
            {t('sheet.measures', { unit: u.lengthLabel })}
          </h3>
          <ul className="divide-y divide-line border-y border-line">
            {MEASURE_FIELDS.map((k) => {
              const last = cmShown(latest.find((m) => m.field === k)?.value ?? null)
              const [min, max] = u.lengthRange(LIMITS[k][0], LIMITS[k][1], lengthStep)
              const label = t(`measure.fields.${k}`)
              const value = measures[k]
              const set = (v: number | null) => setMeasures((m) => ({ ...m, [k]: v }))
              return (
                <li key={k} className="flex min-h-[60px] items-center gap-3 py-2">
                  <span className="w-16 shrink-0 text-[15px] font-medium">{label}</span>
                  {value == null ? (
                    <button
                      type="button"
                      onClick={() => set(last ?? roundToStep(u.cm(FIRST_GUESS[k]), lengthStep))}
                      className="flex h-11 flex-1 items-center justify-between rounded-[var(--radius-input)] px-3 text-left text-[13px] text-ink-faint hover:bg-raised"
                    >
                      <span className="display text-[22px] text-ink-faint">–</span>
                      <span>{last != null ? t('measure.last', { value: u.lengthValue(last) }) : t('measure.tapToAdd')}</span>
                    </button>
                  ) : (
                    <>
                      <Stepper
                        label={label}
                        value={value}
                        onChange={set}
                        step={lengthStep}
                        min={min}
                        max={max}
                        decimal
                        size="sm"
                        unit={u.lengthLabel}
                        format={u.lengthValue}
                        decLabel={t('measure.dec', { field: label, ...stepText(lengthStep, u.lengthLabel) })}
                        incLabel={t('measure.inc', { field: label, ...stepText(lengthStep, u.lengthLabel) })}
                        className="flex-1 [&>label]:sr-only"
                      />
                      <button
                        type="button"
                        aria-label={t('measure.remove', { field: label })}
                        onClick={() => set(null)}
                        className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-faint hover:bg-raised hover:text-ink"
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        {row && (
          <Button
            variant="ghost"
            className={cn('w-full', confirmDelete ? 'text-danger' : 'text-ink-muted')}
            disabled={remove.isPending}
            onClick={() => (confirmDelete ? remove.mutate(row.id, { onSuccess: onDone }) : setConfirmDelete(true))}
          >
            {remove.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
            {confirmDelete ? t('sheet.confirmDelete') : t('sheet.delete')}
          </Button>
        )}
      </div>

      <div className="shrink-0 border-t border-line px-4 pb-3 pt-3">
        {old && <p className="mb-2 text-center text-[12px] text-ink-faint">{t('sheet.oldDayNote')}</p>}
        <ErrorNote error={save.error ?? remove.error} className="mb-2" />
        <Button size="lg" className="w-full" disabled={!canSave} onClick={submit}>
          {save.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
          {t('sheet.save')}
        </Button>
      </div>
    </>
  )
}
