import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Package, Search, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { cn } from '@/lib/utils'
import { useCatalogSearch, useDeleteFood, useFoods, useProductSearch } from '../hooks'
import type { CatalogFood, DraftItem, Food, ProductHit } from '../types'
import { AmountInput } from './AmountInput'

type Props = {
  onPickSaved: (f: Food) => void
  onAdd: (d: DraftItem) => void
  onAskAi: (query: string) => void
  makeKey: () => string
}

/** A per-100 g reference the user portions in grams (catalog row or packaged product). */
type Reference = {
  id: string
  name: string
  detail: string | null
  kcal: number
  protein: number
  carb: number
  fat: number
  portionG: number | null
  portionLabel: string | null
  source: 'catalog' | 'off'
}

/**
 * Search first, ask the AI last. Saved foods, the nutrition catalog (Turkish dishes + USDA) and, on
 * request, packaged products from Open Food Facts; a pick opens an inline gram picker.
 */
export function SearchPanel({ onPickSaved, onAdd, onAskAi, makeKey }: Props) {
  const { t, i18n } = useTranslation('nutrition')
  const lang = i18n.resolvedLanguage === 'en' ? 'en' : 'tr'
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [productQ, setProductQ] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    const id = window.setTimeout(() => setQ(input.trim()), 250)
    return () => window.clearTimeout(id)
  }, [input])

  const foods = useFoods()
  const del = useDeleteFood()
  const catalog = useCatalogSearch(q)
  const products = useProductSearch(productQ)
  const fold = (s: string) => s.toLocaleLowerCase(lang)
  const saved = (foods.data ?? []).filter((f) => !q || fold(f.name).includes(fold(q)))
  const searching = q.length >= 2

  const catalogRefs: Reference[] = (catalog.data ?? []).map((c: CatalogFood) => ({
    id: c.id,
    name: (lang === 'tr' ? c.name_tr : null) ?? c.name_en,
    detail: c.source === 'curated' ? t('search.approx') : 'USDA',
    kcal: Number(c.kcal_100g),
    protein: Number(c.protein_100g),
    carb: Number(c.carb_100g),
    fat: Number(c.fat_100g),
    portionG: c.portion_g == null ? null : Number(c.portion_g),
    portionLabel: (lang === 'tr' ? c.portion_tr : c.portion_en) ?? null,
    source: 'catalog',
  }))
  const productRefs: Reference[] = (products.data ?? []).map((p: ProductHit) => ({
    id: `off:${p.code}`,
    name: p.name,
    detail: p.brand,
    kcal: p.kcal_100g,
    protein: p.protein_100g,
    carb: p.carb_100g,
    fat: p.fat_100g,
    portionG: p.serving_g,
    portionLabel: p.serving_label,
    source: 'off',
  }))

  const pick = (r: Reference, grams: number) => {
    const f = grams / 100
    onAdd({
      key: makeKey(),
      name: r.detail && r.source === 'off' ? `${r.name} (${r.detail})` : r.name,
      portion: `${grams} g`,
      kcal: Math.round(r.kcal * f),
      protein_g: Math.round(r.protein * f * 10) / 10,
      carb_g: Math.round(r.carb * f * 10) / 10,
      fat_g: Math.round(r.fat * f * 10) / 10,
      source: r.source,
      food_id: null,
    })
    setOpen(null)
  }

  return (
    <div className="space-y-4">
      <div className="hairline flex h-12 items-center gap-2 rounded-[var(--radius-input)] bg-surface px-3 focus-within:ring-2 focus-within:ring-volt">
        <Search className="size-4 shrink-0 text-ink-faint" aria-hidden />
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setProductQ(null)
          }}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          className="w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-faint"
        />
        {(catalog.isFetching || products.isFetching) && <Loader2 className="size-4 shrink-0 animate-spin text-ink-faint" aria-hidden />}
      </div>

      {saved.length > 0 && (
        <Group title={searching ? t('search.savedMatches') : t('search.savedRecent')}>
          {saved.slice(0, searching ? 5 : 20).map((f) => (
            <li key={f.id} className="flex items-center">
              <button type="button" onClick={() => onPickSaved(f)} className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left hover:bg-raised/50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{f.name}</span>
                  {f.serving_desc && <span className="block truncate text-[12px] text-ink-faint">{f.serving_desc}</span>}
                </span>
                <span className="tabular shrink-0 text-[14px] font-semibold">{f.kcal}</span>
              </button>
              <button
                type="button"
                aria-label={t('sheet.savedRemove', { name: f.name })}
                onClick={() => del.mutate(f.id)}
                className="flex size-11 shrink-0 items-center justify-center text-ink-faint hover:text-ink"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </Group>
      )}
      {!searching && saved.length === 0 && !foods.isLoading && <p className="text-[13px] leading-snug text-ink-muted">{t('search.hint')}</p>}
      <ErrorNote error={foods.error ?? del.error ?? catalog.error} />

      {searching && (
        <>
          {catalogRefs.length > 0 ? (
            <Group title={t('search.catalog')}>
              {catalogRefs.map((r) => (
                <RefRow key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} onPick={(g) => pick(r, g)} />
              ))}
            </Group>
          ) : (
            !catalog.isFetching && <p className="text-[13px] text-ink-muted">{t('search.noCatalog')}</p>
          )}

          {productQ === q ? (
            <>
              <ErrorNote error={products.error} />
              {productRefs.length > 0 ? (
                <Group title={t('search.products')}>
                  {productRefs.map((r) => (
                    <RefRow key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} onPick={(g) => pick(r, g)} />
                  ))}
                </Group>
              ) : (
                products.isSuccess && <p className="text-[13px] text-ink-muted">{t('search.noProducts')}</p>
              )}
              <p className="text-[11px] text-ink-faint">{t('search.offCredit')}</p>
            </>
          ) : (
            <Button variant="secondary" className="w-full" onClick={() => setProductQ(q)}>
              <Package className="size-4" aria-hidden />
              {t('search.searchProducts')}
            </Button>
          )}

          <div className="hairline flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-surface px-4 py-3">
            <span className="text-[13px] text-ink-muted">{t('search.notFound')}</span>
            <Button size="sm" className="h-11 shrink-0" onClick={() => onAskAi(input.trim())}>
              <Sparkles className="size-4" aria-hidden />
              {t('search.askAi')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="eyebrow mb-2">{title}</h3>
      <ul className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">{children}</ul>
    </section>
  )
}

function RefRow({ r, open, onToggle, onPick }: { r: Reference; open: boolean; onToggle: () => void; onPick: (grams: number) => void }) {
  const { t, i18n } = useTranslation('nutrition')
  const nf = new Intl.NumberFormat(i18n.resolvedLanguage === 'en' ? 'en' : 'tr', { maximumFractionDigits: 1 })
  const [grams, setGrams] = useState<number>(r.portionG ?? 100)
  const f = grams / 100
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left hover:bg-raised/50">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">{r.name}</span>
          <span className="block truncate text-[12px] text-ink-faint">
            {[r.detail, t('search.per100', { kcal: nf.format(r.kcal) })].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="tabular shrink-0 text-[14px] font-semibold">{Math.round(r.kcal)}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line bg-bg/40 px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {r.portionG != null && (
              <Chip active={grams === r.portionG} onClick={() => setGrams(r.portionG!)}>
                {r.portionLabel ? `${r.portionLabel} (${nf.format(r.portionG)} g)` : `${nf.format(r.portionG)} g`}
              </Chip>
            )}
            {[50, 100, 150, 200].map((g) => (
              <Chip key={g} active={grams === g} onClick={() => setGrams(g)}>
                {g} g
              </Chip>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <AmountInput label={t('search.grams')} value={grams} onChange={(n) => setGrams(Math.max(1, n))} max={2000} integer suffix="g" />
            <Button className="h-11" onClick={() => onPick(grams)}>
              {t('search.addGrams', { kcal: Math.round(r.kcal * f) })}
            </Button>
          </div>
          <p className="tabular text-[12px] text-ink-faint">
            {t('short.protein')} {nf.format(r.protein * f)} · {t('short.carb')} {nf.format(r.carb * f)} · {t('short.fat')} {nf.format(r.fat * f)}
          </p>
        </div>
      )}
    </li>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn('h-11 min-w-11 rounded-full px-3 text-[13px] font-medium transition-colors', active ? 'bg-ink text-bg' : 'hairline text-ink-muted hover:text-ink')}
    >
      {children}
    </button>
  )
}
