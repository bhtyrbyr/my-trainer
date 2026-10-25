import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, ChevronDown, Loader2, Search, Sparkles, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { cn } from '@/lib/utils'
import { useAddMeals, useDeleteFood, useEstimateFood, useFoods } from '../hooks'
import { MEAL_SLOTS, type DraftItem, type EntrySource, type EstimateItem, type Food, type MealSlot } from '../types'
import { AmountInput } from './AmountInput'

const TABS = ['describe', 'photo', 'manual', 'saved'] as const
type Tab = (typeof TABS)[number]

type Props = { open: boolean; day: string; slot: MealSlot; onClose: () => void }

let seq = 0
const key = () => `d${Date.now().toString(36)}${(seq++).toString(36)}`
const fromEstimate = (it: EstimateItem, source: EntrySource): DraftItem => ({ key: key(), ...it, source, food_id: null })

/**
 * Add food. Every way in (AI text, AI photo, manual, saved foods) lands in one editable "to add"
 * list; one button logs the whole list into the chosen meal. AI values are labelled as estimates.
 */
export function AddFoodSheet({ open, day, slot: initialSlot, onClose }: Props) {
  const { t } = useTranslation('nutrition')
  const [slot, setSlot] = useState<MealSlot>(initialSlot)
  const [tab, setTab] = useState<Tab>('describe')
  const [drafts, setDrafts] = useState<DraftItem[]>([])
  const [usedFoods, setUsedFoods] = useState<Food[]>([])
  const [saveToFoods, setSaveToFoods] = useState(false)
  const add = useAddMeals()

  useEffect(() => {
    if (!open) return
    setSlot(initialSlot)
    setDrafts([])
    setUsedFoods([])
    setSaveToFoods(false)
    add.reset()
     
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  const kcal = drafts.reduce((s, d) => s + Math.round(d.kcal), 0)
  const canSave = drafts.length > 0 && drafts.every((d) => d.name.trim()) && !add.isPending
  const anyNew = drafts.some((d) => d.source !== 'food')
  const append = (items: DraftItem[]) => setDrafts((prev) => [...prev, ...items])

  return (
    <div role="dialog" aria-modal="true" aria-label={t('sheet.title')} className="fixed inset-0 z-50 flex flex-col bg-bg pt-safe pb-safe">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
        <h2 className="text-lg font-bold tracking-tight">{t('sheet.title')}</h2>
        <Button variant="ghost" size="icon" aria-label={t('actions.close')} onClick={onClose}>
          <X className="size-5" aria-hidden />
        </Button>
      </header>

      <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto">
        <div className="space-y-4 px-4 pt-4">
          <fieldset>
            <legend className="sr-only">{t('sheet.slot')}</legend>
            <div className="grid grid-cols-4 gap-1.5">
              {MEAL_SLOTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={slot === s}
                  onClick={() => setSlot(s)}
                  className={cn(
                    'h-11 truncate rounded-full px-2 text-[13px] font-semibold transition-colors',
                    slot === s ? 'bg-ink text-bg' : 'hairline text-ink-muted hover:text-ink',
                  )}
                >
                  {t(`slots.${s}`)}
                </button>
              ))}
            </div>
          </fieldset>

          <div role="tablist" className="hairline grid grid-cols-4 rounded-full bg-surface p-1">
            {TABS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn('h-10 rounded-full text-[13px] font-medium transition-colors', tab === k ? 'bg-raised text-ink' : 'text-ink-muted hover:text-ink')}
              >
                {t(`sheet.tabs.${k}`)}
              </button>
            ))}
          </div>

          <div role="tabpanel">
            {tab === 'describe' && <EstimatePanel mode="text" onItems={(items) => append(items.map((i) => fromEstimate(i, 'ai_text')))} />}
            {tab === 'photo' && <EstimatePanel mode="photo" onItems={(items) => append(items.map((i) => fromEstimate(i, 'ai_photo')))} />}
            {tab === 'manual' && <ManualPanel onAdd={(d) => append([d])} />}
            {tab === 'saved' && (
              <SavedPanel
                onPick={(f) => {
                  append([{ key: key(), name: f.name, portion: f.serving_desc ?? '', kcal: f.kcal, protein_g: Number(f.protein_g), carb_g: Number(f.carb_g), fat_g: Number(f.fat_g), source: 'food', food_id: f.id }])
                  setUsedFoods((u) => (u.some((x) => x.id === f.id) ? u : [...u, f]))
                }}
              />
            )}
          </div>
        </div>

        {drafts.length > 0 && (
          <section className="mt-6 px-4 pb-4" aria-labelledby="drafts-title">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 id="drafts-title" className="eyebrow">
                {t('sheet.draftsTitle')}
              </h3>
              {drafts.some((d) => d.source === 'ai_text' || d.source === 'ai_photo') && <span className="text-[11px] text-ink-faint">{t('sheet.estimateBadge')}</span>}
            </div>
            <ul className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
              {drafts.map((d) => (
                <DraftRow
                  key={d.key}
                  draft={d}
                  onChange={(next) => setDrafts((all) => all.map((x) => (x.key === d.key ? next : x)))}
                  onRemove={() => setDrafts((all) => all.filter((x) => x.key !== d.key))}
                />
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="mx-auto w-full max-w-md shrink-0 border-t border-line px-4 pb-3 pt-2">
        {anyNew && (
          <label className="flex h-11 items-center gap-3 text-[14px] text-ink-muted">
            <input type="checkbox" checked={saveToFoods} onChange={(e) => setSaveToFoods(e.target.checked)} className="size-5 accent-[var(--color-volt)]" />
            {t('sheet.saveToFoods')}
          </label>
        )}
        <ErrorNote error={add.error} className="mb-2" />
        <Button
          size="lg"
          className="w-full"
          disabled={!canSave}
          onClick={() => add.mutate({ day, slot, drafts, saveToFoods, usedFoods }, { onSuccess: onClose })}
        >
          {add.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
          {drafts.length ? t('sheet.submit', { count: drafts.length, kcal }) : t('sheet.submitEmpty')}
        </Button>
        <p className="mt-2 text-center text-[11px] text-ink-faint">{t('sheet.points')}</p>
      </div>
    </div>
  )
}

function EstimatePanel({ mode, onItems }: { mode: 'text' | 'photo'; onItems: (items: EstimateItem[]) => void }) {
  const { t } = useTranslation('nutrition')
  const estimate = useEstimateFood()
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [empty, setEmpty] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // Plaintext preview lives only in memory and is revoked when replaced or unmounted.
  const previewUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo])
  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl])

  const ready = mode === 'text' ? text.trim().length >= 2 : photo !== null
  const run = () => {
    setEmpty(false)
    estimate.mutate(
      { text, photo: mode === 'photo' ? photo : null },
      {
        onSuccess: (r) => {
          if (r.items.length === 0) setEmpty(true)
          else {
            onItems(r.items)
            setText('')
            setPhoto(null)
          }
        },
      },
    )
  }

  return (
    <div className="space-y-3">
      {mode === 'photo' && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              e.target.value = ''
              if (f) setPhoto(f)
            }}
          />
          {previewUrl ? (
            <div className="flex items-center gap-3">
              <img src={previewUrl} alt={t('sheet.photoAlt')} className="hairline size-24 shrink-0 rounded-[var(--radius-input)] object-cover" />
              <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                <Camera className="size-4" aria-hidden />
                {t('sheet.photoChange')}
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="hairline flex h-28 w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-dashed bg-surface text-[14px] font-medium text-ink-muted hover:text-ink"
            >
              <Camera className="size-6" aria-hidden />
              {t('sheet.photoPick')}
            </button>
          )}
        </>
      )}
      <label className="block">
        <span className={cn('mb-1.5 block', mode === 'text' ? 'eyebrow' : 'sr-only')}>{mode === 'text' ? t('sheet.describeLabel') : t('sheet.photoHint')}</span>
        {mode === 'text' ? (
          <textarea
            value={text}
            maxLength={500}
            rows={3}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('sheet.describePlaceholder')}
            className="hairline w-full resize-none rounded-[var(--radius-input)] bg-surface px-3 py-2.5 text-[16px] leading-snug text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-volt"
          />
        ) : (
          <input
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('sheet.photoHint')}
            className="hairline h-11 w-full rounded-[var(--radius-input)] bg-surface px-3 text-[16px] text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-volt"
          />
        )}
      </label>
      <Button variant="secondary" className="w-full" disabled={!ready || estimate.isPending} onClick={run}>
        {estimate.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4 text-volt" aria-hidden />}
        {estimate.isPending ? t('sheet.estimating') : t('sheet.estimate')}
      </Button>
      <ErrorNote error={estimate.error} />
      {empty && <p className="text-[13px] text-ink-muted">{t('sheet.noFood')}</p>}
      {estimate.data?.remaining != null && !estimate.isPending && <p className="text-[12px] text-ink-faint">{t('sheet.remaining', { count: estimate.data.remaining })}</p>}
      <p className="text-[11px] leading-snug text-ink-faint">{t('sheet.privacy')}</p>
    </div>
  )
}

function ManualPanel({ onAdd }: { onAdd: (d: DraftItem) => void }) {
  const { t } = useTranslation('nutrition')
  const [name, setName] = useState('')
  const [portion, setPortion] = useState('')
  const [v, setV] = useState({ kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 })
  return (
    <div className="space-y-3">
      <input
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('sheet.manualName')}
        aria-label={t('sheet.manualName')}
        className="hairline h-11 w-full rounded-[var(--radius-input)] bg-surface px-3 text-[16px] text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-volt"
      />
      <input
        value={portion}
        maxLength={60}
        onChange={(e) => setPortion(e.target.value)}
        placeholder={t('sheet.manualPortion')}
        aria-label={t('sheet.manualPortion')}
        className="hairline h-11 w-full rounded-[var(--radius-input)] bg-surface px-3 text-[16px] text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-volt"
      />
      <MacroInputs value={v} onChange={setV} />
      <Button
        variant="secondary"
        className="w-full"
        disabled={!name.trim()}
        onClick={() => {
          onAdd({ key: key(), name: name.trim(), portion: portion.trim(), ...v, source: 'manual', food_id: null })
          setName('')
          setPortion('')
          setV({ kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 })
        }}
      >
        {t('sheet.manualAdd')}
      </Button>
    </div>
  )
}

function SavedPanel({ onPick }: { onPick: (f: Food) => void }) {
  const { t, i18n } = useTranslation('nutrition')
  const foods = useFoods()
  const del = useDeleteFood()
  const [q, setQ] = useState('')
  const locale = i18n.resolvedLanguage === 'en' ? 'en' : 'tr'
  const list = (foods.data ?? []).filter((f) => f.name.toLocaleLowerCase(locale).includes(q.trim().toLocaleLowerCase(locale)))
  if (foods.isLoading) return <div className="h-32 animate-pulse rounded-[var(--radius-card)] bg-surface" aria-busy="true" />
  if ((foods.data ?? []).length === 0) return <p className="text-[13px] leading-snug text-ink-muted">{t('sheet.savedEmpty')}</p>
  return (
    <div className="space-y-3">
      <ErrorNote error={foods.error ?? del.error} />
      <div className="hairline flex h-11 items-center gap-2 rounded-[var(--radius-input)] bg-surface px-3">
        <Search className="size-4 shrink-0 text-ink-faint" aria-hidden />
        <input
          type="search"
          inputMode="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('sheet.savedSearch')}
          aria-label={t('sheet.savedSearch')}
          className="w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-faint"
        />
      </div>
      {list.length === 0 ? (
        <p className="text-[13px] text-ink-muted">{t('sheet.savedNone')}</p>
      ) : (
        <ul className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
          {list.map((f) => (
            <li key={f.id} className="flex items-center">
              <button type="button" onClick={() => onPick(f)} className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left hover:bg-raised/50">
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
        </ul>
      )}
    </div>
  )
}

function DraftRow({ draft, onChange, onRemove }: { draft: DraftItem; onChange: (d: DraftItem) => void; onRemove: () => void }) {
  const { t, i18n } = useTranslation('nutrition')
  const [open, setOpen] = useState(false)
  const nf = new Intl.NumberFormat(i18n.resolvedLanguage === 'en' ? 'en' : 'tr', { maximumFractionDigits: 1 })
  return (
    <li>
      <div className="flex items-center">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-4 text-left">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium">{draft.name || '–'}</span>
            <span className="tabular block truncate text-[12px] text-ink-faint">
              {draft.portion ? `${draft.portion} · ` : ''}
              {t('short.protein')} {nf.format(draft.protein_g)} · {t('short.carb')} {nf.format(draft.carb_g)} · {t('short.fat')} {nf.format(draft.fat_g)}
            </span>
          </span>
          <span className="tabular shrink-0 text-[15px] font-semibold">{Math.round(draft.kcal)}</span>
          <ChevronDown className={cn('size-4 shrink-0 text-ink-faint transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
        <button type="button" aria-label={t('sheet.draftRemove', { name: draft.name })} onClick={onRemove} className="flex size-11 shrink-0 items-center justify-center text-ink-faint hover:text-ink">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {open && (
        <div className="space-y-3 border-t border-line bg-bg/40 px-4 py-3">
          <div className="grid grid-cols-[1.4fr_1fr] gap-2">
            <input
              value={draft.name}
              maxLength={80}
              aria-label={t('sheet.manualName')}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
              className="hairline h-11 min-w-0 rounded-[var(--radius-input)] bg-bg px-3 text-[16px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-volt"
            />
            <input
              value={draft.portion}
              maxLength={60}
              aria-label={t('sheet.manualPortion')}
              onChange={(e) => onChange({ ...draft, portion: e.target.value })}
              className="hairline h-11 min-w-0 rounded-[var(--radius-input)] bg-bg px-3 text-[16px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-volt"
            />
          </div>
          <MacroInputs value={draft} onChange={(v) => onChange({ ...draft, ...v })} />
        </div>
      )}
    </li>
  )
}

type Macros = { kcal: number; protein_g: number; carb_g: number; fat_g: number }

function MacroInputs({ value, onChange }: { value: Macros; onChange: (v: Macros) => void }) {
  const { t } = useTranslation('nutrition')
  return (
    <div className="grid grid-cols-4 gap-2">
      <AmountInput label={t('units.kcal')} value={value.kcal} onChange={(n) => onChange({ ...value, kcal: n })} max={5000} integer />
      <AmountInput label={t('short.protein')} value={value.protein_g} onChange={(n) => onChange({ ...value, protein_g: n })} max={500} />
      <AmountInput label={t('short.carb')} value={value.carb_g} onChange={(n) => onChange({ ...value, carb_g: n })} max={1000} />
      <AmountInput label={t('short.fat')} value={value.fat_g} onChange={(n) => onChange({ ...value, fat_g: n })} max={500} />
    </div>
  )
}
