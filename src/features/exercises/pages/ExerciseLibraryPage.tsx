import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, Loader2, Search, SearchX, X } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { cn } from '@/lib/utils'
import { useExerciseFacets, useExerciseSearch } from '../hooks'
import { exerciseName } from '../name'
import type { Exercise, ExerciseFilters } from '../types'
import { useVocab } from '../vocab'
import { ExerciseThumb } from '../components/ExerciseThumb'
import { OptionSheet } from '../components/OptionSheet'
import { BackButton } from '../components/BackButton'

type SheetKind = 'muscle' | 'equipment' | null

/**
 * Point of view: a reference index, not a gallery. Search is the dominant control; body parts are one
 * swipeable row; muscle and equipment hide behind two quiet pickers. Results are ruled rows with the
 * GIF on its white card, so the movement is recognisable at a glance. Filters live in the URL, so
 * coming back from a detail page restores the list.
 */
export function ExerciseLibraryPage() {
  const { t, i18n } = useTranslation('exercises')
  const vocab = useVocab()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const bodyPart = params.get('bp') ?? undefined
  const muscle = params.get('m') ?? undefined
  const equipment = params.get('eq') ?? undefined

  const [input, setInput] = useState(q)
  const [sheet, setSheet] = useState<SheetKind>(null)

  const setParam = useCallback(
    (key: string, value: string | undefined) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (value) next.set(key, value)
          else next.delete(key)
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  // debounce typing into the URL (and so into the query key)
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (input.trim() !== q) setParam('q', input.trim() || undefined)
    }, 300)
    return () => window.clearTimeout(id)
  }, [input, q, setParam])

  const filters = useMemo<ExerciseFilters>(() => ({ q, bodyPart, muscle, equipment }), [q, bodyPart, muscle, equipment])
  const search = useExerciseSearch(filters)
  const facets = useExerciseFacets()
  const items = useMemo(() => search.data?.pages.flat() ?? [], [search.data])
  const hasFilters = Boolean(q || bodyPart || muscle || equipment)

  // infinite scroll: load the next page when the sentinel nears the viewport
  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = search
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage()
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const clearAll = () => {
    setInput('')
    setParams(new URLSearchParams(), { replace: true })
  }

  return (
    <PageShell
      title={t('library.title')}
      leading={
        <div className="-ml-2 flex items-center gap-1">
          <BackButton fallback="/workouts" label={t('library.back')} />
          <p className="truncate text-xl font-bold tracking-tight">{t('library.title')}</p>
        </div>
      }
      className="px-0 py-0"
    >
      {/* sticky filter block under the page header */}
      <div className="sticky top-[calc(var(--sat)+3.5rem)] z-20 space-y-3 border-b border-line bg-bg/90 px-4 pb-3 pt-3 backdrop-blur">
        <label className="hairline flex h-12 items-center gap-2.5 rounded-[var(--radius-input)] bg-surface px-3.5 focus-within:border-line-strong">
          <Search className="size-[18px] shrink-0 text-ink-faint" aria-hidden />
          <span className="sr-only">{t('library.searchPlaceholder')}</span>
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('library.searchPlaceholder')}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[16px] text-ink placeholder:text-ink-faint focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {input && (
            <button
              type="button"
              onClick={() => setInput('')}
              aria-label={t('library.clearSearch')}
              className="-mr-2 flex size-11 items-center justify-center rounded-full text-ink-faint hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </label>

        <div
          role="group"
          aria-label={t('library.bodyPartLabel')}
          // contain: the scroller's intrinsic width must not widen the AppShell flex column on desktop
          className="-mx-4 flex gap-2 overflow-x-auto px-4 [contain:inline-size] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <Chip active={!bodyPart} onClick={() => setParam('bp', undefined)}>
            {t('library.all')}
          </Chip>
          {(facets.data?.bodyParts ?? []).map((bp) => (
            <Chip key={bp} active={bodyPart === bp} onClick={() => setParam('bp', bodyPart === bp ? undefined : bp)}>
              {vocab.bodyPart(bp)}
            </Chip>
          ))}
        </div>

        <div className="flex gap-2">
          <PickerButton
            label={t('library.muscle')}
            value={muscle ? vocab.muscle(muscle) : undefined}
            onOpen={() => setSheet('muscle')}
            onClear={() => setParam('m', undefined)}
            clearLabel={t('library.clearFilters')}
          />
          <PickerButton
            label={t('library.equipment')}
            value={equipment ? vocab.equipment(equipment) : undefined}
            onOpen={() => setSheet('equipment')}
            onClear={() => setParam('eq', undefined)}
            clearLabel={t('library.clearFilters')}
          />
        </div>
      </div>

      <div className="px-4 pb-6 pt-1">
        <ErrorNote error={search.error ?? facets.error} className="my-3" />

        {search.isLoading ? (
          <SkeletonRows />
        ) : items.length === 0 && !search.error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-raised text-ink-muted">
              <SearchX className="size-6" aria-hidden />
            </span>
            <p className="text-[17px] font-semibold">{t('library.empty.title')}</p>
            <p className="max-w-[30ch] text-sm text-ink-muted">{t('library.empty.body')}</p>
            {hasFilters && (
              <Button variant="secondary" className="mt-2" onClick={clearAll}>
                {t('library.clearFilters')}
              </Button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((ex) => (
              <Row key={ex.id} ex={ex} lang={i18n.resolvedLanguage} />
            ))}
          </ul>
        )}

        <div ref={sentinel} />
        {hasNextPage && (
          <Button variant="ghost" className="mt-2 w-full" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            {isFetchingNextPage ? <Loader2 className="size-4 animate-spin" aria-hidden /> : t('library.more')}
          </Button>
        )}
        {!hasNextPage && items.length > 0 && <p className="eyebrow py-6 text-center">{t('library.end')}</p>}
      </div>

      <OptionSheet
        open={sheet === 'muscle'}
        title={t('library.muscle')}
        closeLabel={t('library.close')}
        anyLabel={t('library.anyMuscle')}
        options={sortByLabel((facets.data?.muscles ?? []).map((v) => ({ value: v, label: vocab.muscle(v) })), i18n.resolvedLanguage)}
        value={muscle}
        onChange={(v) => setParam('m', v)}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        open={sheet === 'equipment'}
        title={t('library.equipment')}
        closeLabel={t('library.close')}
        anyLabel={t('library.anyEquipment')}
        options={sortByLabel((facets.data?.equipment ?? []).map((v) => ({ value: v, label: vocab.equipment(v) })), i18n.resolvedLanguage)}
        value={equipment}
        onChange={(v) => setParam('eq', v)}
        onClose={() => setSheet(null)}
      />
    </PageShell>
  )
}

function sortByLabel<T extends { label: string }>(list: T[], lang: string | undefined): T[] {
  return [...list].sort((a, b) => a.label.localeCompare(b.label, lang))
}

function Row({ ex, lang }: { ex: Exercise; lang: string | undefined }) {
  const vocab = useVocab()
  const meta = [...ex.target_muscles.map(vocab.muscle), ...ex.equipment.map(vocab.equipment)].join(' · ')
  return (
    <li>
      <Link
        to={`/exercises/${ex.id}`}
        className="group flex items-center gap-3.5 py-3 transition-colors active:bg-surface/60"
      >
        <ExerciseThumb gifPath={ex.gif_path} size={56} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium leading-snug text-ink">{exerciseName(ex, lang)}</span>
          <span className="mt-0.5 block truncate text-[13px] text-ink-faint">{meta}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-11 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors',
        active ? 'border-volt/40 bg-volt/12 text-volt' : 'border-line bg-surface text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function PickerButton({
  label,
  value,
  onOpen,
  onClear,
  clearLabel,
}: {
  label: string
  value: string | undefined
  onOpen: () => void
  onClear: () => void
  clearLabel: string
}) {
  return (
    <div
      className={cn(
        'flex h-11 min-w-0 flex-1 items-center rounded-[var(--radius-input)] border transition-colors',
        value ? 'border-volt/40 bg-volt/12' : 'border-line bg-surface',
      )}
    >
      <button type="button" onClick={onOpen} aria-haspopup="dialog" className="flex h-full min-w-0 flex-1 items-center gap-2 pl-3.5 pr-2 text-left">
        <span className="min-w-0 flex-1 truncate text-sm">
          {value ? <span className="font-medium text-volt">{value}</span> : <span className="text-ink-muted">{label}</span>}
        </span>
        {!value && <ChevronDown className="size-4 shrink-0 text-ink-faint" aria-hidden />}
      </button>
      {value && (
        <button type="button" onClick={onClear} aria-label={`${clearLabel}: ${label}`} className="flex size-11 shrink-0 items-center justify-center text-volt">
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

function SkeletonRows() {
  return (
    <ul aria-hidden className="divide-y divide-line">
      {Array.from({ length: 8 }, (_, i) => (
        <li key={i} className="flex items-center gap-3.5 py-3">
          <span className="size-14 shrink-0 animate-pulse rounded-[var(--radius-input)] bg-raised" />
          <span className="flex-1 space-y-2">
            <span className="block h-3.5 w-3/5 animate-pulse rounded bg-raised" />
            <span className="block h-3 w-2/5 animate-pulse rounded bg-raised/70" />
          </span>
        </li>
      ))}
    </ul>
  )
}
