import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { cn } from '@/lib/utils'
import { useDeleteMeal, useUpdateMeal } from '../hooks'
import { MEAL_SLOTS, type MealEntry } from '../types'
import { AmountInput } from './AmountInput'
import { BottomSheet } from './BottomSheet'

/** Edit or delete one logged food. */
export function EntrySheet({ entry, onClose }: { entry: MealEntry | null; onClose: () => void }) {
  const { t } = useTranslation('nutrition')
  const update = useUpdateMeal()
  const remove = useDeleteMeal()
  const [form, setForm] = useState(() => toForm(entry))
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    setForm(toForm(entry))
    setConfirm(false)
    update.reset()
    remove.reset()
     
  }, [entry?.id])

  if (!entry) return null
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))
  const valid = form.name.trim().length > 0

  return (
    <BottomSheet open label={t('entry.title')} closeLabel={t('actions.close')} onClose={onClose}>
      <h2 className="display text-[24px]">{t('entry.title')}</h2>
      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">{t('entry.name')}</span>
          <input
            value={form.name}
            maxLength={120}
            onChange={(e) => set('name', e.target.value)}
            className="hairline h-11 w-full rounded-[var(--radius-input)] bg-bg px-3 text-[16px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-volt"
          />
        </label>
        <div className="grid grid-cols-4 gap-2">
          <AmountInput label={t('entry.kcal')} value={form.kcal} onChange={(v) => set('kcal', v)} max={10000} integer />
          <AmountInput label={t('short.protein')} value={form.protein_g} onChange={(v) => set('protein_g', v)} max={1000} />
          <AmountInput label={t('short.carb')} value={form.carb_g} onChange={(v) => set('carb_g', v)} max={2000} />
          <AmountInput label={t('short.fat')} value={form.fat_g} onChange={(v) => set('fat_g', v)} max={1000} />
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">{t('entry.slot')}</legend>
          <div className="grid grid-cols-4 gap-1.5">
            {MEAL_SLOTS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={form.meal_slot === s}
                onClick={() => set('meal_slot', s)}
                className={cn(
                  'h-11 truncate rounded-full px-2 text-[13px] font-semibold transition-colors',
                  form.meal_slot === s ? 'bg-ink text-bg' : 'hairline text-ink-muted hover:text-ink',
                )}
              >
                {t(`slots.${s}`)}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      <ErrorNote error={update.error ?? remove.error} className="mt-4" />
      <div className="mt-6 grid gap-2 pb-5">
        <Button
          size="lg"
          disabled={!valid || update.isPending}
          onClick={() =>
            update.mutate(
              { id: entry.id, day: entry.eaten_on, patch: { ...form, name: form.name.trim() } },
              { onSuccess: onClose },
            )
          }
        >
          {update.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
          {t('entry.save')}
        </Button>
        <Button
          size="lg"
          variant="ghost"
          className={confirm ? 'text-danger' : undefined}
          disabled={remove.isPending}
          onClick={() => (confirm ? remove.mutate({ id: entry.id, day: entry.eaten_on }, { onSuccess: onClose }) : setConfirm(true))}
        >
          {remove.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
          {confirm ? t('entry.confirmDelete') : t('entry.delete')}
        </Button>
      </div>
    </BottomSheet>
  )
}

function toForm(e: MealEntry | null) {
  return {
    name: e?.name ?? '',
    kcal: e?.kcal ?? 0,
    protein_g: Number(e?.protein_g ?? 0),
    carb_g: Number(e?.carb_g ?? 0),
    fat_g: Number(e?.fat_g ?? 0),
    meal_slot: e?.meal_slot ?? 'snack',
  }
}
