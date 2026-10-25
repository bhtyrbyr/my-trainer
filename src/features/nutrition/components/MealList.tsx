import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { bySlot, totalsOf } from '../logic'
import { MEAL_SLOTS, type MealEntry, type MealSlot } from '../types'

type Props = { entries: MealEntry[]; onAdd: (slot: MealSlot) => void; onOpen: (entry: MealEntry) => void }

/** One ruled surface; slots are headings inside it (not four cards), each with its subtotal and an add button. */
export function MealList({ entries, onAdd, onOpen }: Props) {
  const { t, i18n } = useTranslation('nutrition')
  const nf = new Intl.NumberFormat(i18n.resolvedLanguage === 'en' ? 'en' : 'tr', { maximumFractionDigits: 0 })
  const groups = bySlot(entries)

  return (
    <div className="hairline overflow-hidden rounded-[var(--radius-card)] bg-surface">
      {MEAL_SLOTS.map((slot, i) => {
        const rows = groups[slot]
        const sum = totalsOf(rows).kcal
        const name = t(`slots.${slot}`)
        return (
          <section key={slot} aria-label={name} className={i > 0 ? 'border-t border-line' : undefined}>
            <div className="flex h-12 items-center gap-3 pl-4 pr-1.5">
              <h3 className="flex-1 text-[15px] font-semibold">{name}</h3>
              {rows.length > 0 && (
                <span className="tabular text-[13px] text-ink-muted">
                  {nf.format(sum)} {t('units.kcal')}
                </span>
              )}
              <button
                type="button"
                onClick={() => onAdd(slot)}
                aria-label={t('addTo', { slot: name })}
                className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
              >
                <Plus className="size-4" aria-hidden />
              </button>
            </div>
            {rows.length > 0 && (
              <ul className="pb-1.5">
                {rows.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(e)}
                      aria-label={t('entry.edit', { name: e.name })}
                      className="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left hover:bg-raised/50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] text-ink">{e.name}</span>
                        <span className="tabular block text-[11px] text-ink-faint">
                          {t('short.protein')} {nf.format(Number(e.protein_g))} · {t('short.carb')} {nf.format(Number(e.carb_g))} · {t('short.fat')} {nf.format(Number(e.fat_g))}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-[14px] font-semibold">{nf.format(e.kcal)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
