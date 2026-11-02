import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, Film, Loader2, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { BodyGlyph, exerciseDbGifUrl, exerciseMedia, exerciseName, ExerciseGif, Flipbook, useVocab, type Exercise } from '@/features/exercises'
import { cn } from '@/lib/utils'
import { isSearchable, matchKindOf, SEARCH_MAX, simplifyExerciseName, type ExerciseDbHit } from '../exercisedbLogic'
import { useExerciseDbSearch, useSetExerciseMedia } from '../hooks'

export type PickerExercise = Pick<
  Exercise,
  'id' | 'name_en' | 'body_parts' | 'equipment' | 'exercisedb_id' | 'media_frames' | 'target_muscles' | 'secondary_muscles'
> & { exercisedb_match?: string | null }

type Props = {
  exercise: PickerExercise | null
  onClose: () => void
  /** the admin worklist links on to the exercise; the exercise page itself does not */
  showOpenLink?: boolean
}

/**
 * Pick the ExerciseDB animation of one catalog exercise by hand (admin). Point of view: a contact sheet.
 * Our own picture of the movement (illustration or body map) and its name stay pinned on top as the
 * reference; below, the ExerciseDB candidates as a two-column grid of live GIFs on the light plate. One
 * tap selects (volt ring), the only primary action in the thumb zone saves. A current animation sits
 * in its own row with "Remove". Full-height sheet on phones, centred dialog on desktop.
 */
export function ExerciseMediaPicker({ exercise, onClose, showOpenLink = true }: Props) {
  if (!exercise) return null
  // portalled: an animated (transformed) ancestor such as the exercise hero would otherwise become the
  // containing block of the fixed overlay and the sheet would render inside the page
  return createPortal(<PickerSheet key={exercise.id} exercise={exercise} onClose={onClose} showOpenLink={showOpenLink} />, document.body)
}

function PickerSheet({ exercise, onClose, showOpenLink }: { exercise: PickerExercise; onClose: () => void; showOpenLink: boolean }) {
  const { t } = useTranslation('admin')
  const vocab = useVocab()
  const name = exerciseName(exercise)
  const [input, setInput] = useState(() => simplifyExerciseName(exercise.name_en))
  const [term, setTerm] = useState(input)
  const [selected, setSelected] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const search = useExerciseDbSearch(term)
  const save = useSetExerciseMedia()
  const current = exercise.exercisedb_id
  const closeRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const id = window.setTimeout(() => setTerm(input.trim().slice(0, SEARCH_MAX)), 400)
    return () => window.clearTimeout(id)
  }, [input])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !confirmRemove && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, confirmRemove])

  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [])

  const apply = (exercisedbId: string | null) =>
    save.mutate(
      { exercise, exercisedbId },
      {
        onSuccess: () => {
          setConfirmRemove(false)
          onClose()
        },
      },
    )

  const meta = [...exercise.body_parts.map(vocab.bodyPart), ...exercise.equipment.map(vocab.equipment)].join(' · ')
  const searchable = isSearchable(term)
  // a disabled query keeps its placeholder (the previous term's hits): show nothing below two letters
  const hits = searchable ? (search.data ?? []) : []

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center lg:items-center" role="presentation">
      <button type="button" aria-label={t('exercisedb.picker.close')} tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-bg/70 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('exercisedb.picker.label', { name })}
        className="hairline rise-in relative flex h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[var(--radius-sheet)] border-b-0 bg-surface lg:h-[min(860px,88dvh)] lg:rounded-[var(--radius-sheet)] lg:border-b"
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-5">
          {/* the reference: our own picture of the movement and its name */}
          <header className="flex items-start gap-4">
            <OwnMedia exercise={exercise} />
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="eyebrow">{t('exercisedb.picker.eyebrow')}</p>
              <h2 className="display mt-1.5 text-[22px] leading-[1.1]">{name}</h2>
              {meta && <p className="mt-1 truncate text-[12px] text-ink-faint">{meta}</p>}
              {showOpenLink && (
                <Link
                  to={`/exercises/${exercise.id}`}
                  className="-mb-2 -ml-1 inline-flex h-11 items-center gap-1 px-1 text-[13px] font-medium text-ink-muted underline decoration-line-strong underline-offset-4 hover:text-ink"
                >
                  {t('exercisedb.picker.open')}
                  <ArrowUpRight className="size-3.5" aria-hidden />
                </Link>
              )}
            </div>
            <Button ref={closeRef} variant="ghost" size="icon" aria-label={t('exercisedb.picker.close')} onClick={onClose} className="-mr-2 -mt-2 shrink-0">
              <X className="size-5" aria-hidden />
            </Button>
          </header>

          {current && (
            <CurrentRow
              id={current}
              kind={matchKindOf(exercise)}
              name={name}
              pending={save.isPending}
              onRemove={() => setConfirmRemove(true)}
            />
          )}

          <form role="search" onSubmit={(e: FormEvent) => e.preventDefault()} className="relative mt-6">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input
              type="search"
              enterKeyHint="search"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              ref={inputRef}
              value={input}
              maxLength={SEARCH_MAX}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('exercisedb.picker.search')}
              aria-label={t('exercisedb.picker.search')}
              className="hairline h-12 w-full rounded-full bg-bg pl-10 pr-12 text-[16px] text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-volt [&::-webkit-search-cancel-button]:hidden"
            />
            {search.isFetching ? (
              <Loader2 className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-faint" aria-hidden />
            ) : (
              input && (
                <button
                  type="button"
                  aria-label={t('exercisedb.picker.clear')}
                  onClick={() => {
                    setInput('')
                    inputRef.current?.focus()
                  }}
                  className="absolute right-0.5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-ink-faint hover:text-ink"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )
            )}
          </form>
          <p className="tabular mb-4 mt-2 px-1 text-[12px] text-ink-faint" aria-live="polite">
            {!searchable ? t('exercisedb.picker.hint') : search.data && !search.isPlaceholderData ? t('exercisedb.picker.results', { count: hits.length }) : ' '}
          </p>

          <ErrorNote error={search.error} className="mb-4" />

          {searchable && search.isLoading ? (
            <TileSkeleton />
          ) : searchable && search.data && hits.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center text-ink-faint">
              <Film className="size-7" aria-hidden />
              <p className="max-w-[30ch] text-sm">{t('exercisedb.picker.empty', { q: term })}</p>
            </div>
          ) : (
            hits.length > 0 && (
              <ul role="radiogroup" aria-label={t('exercisedb.picker.resultsLabel')} className="grid grid-cols-2 gap-x-3 gap-y-5">
                {hits.map((h) => (
                  <Tile key={h.id} hit={h} selected={selected === h.id} current={current === h.id} onSelect={() => setSelected(h.id)} />
                ))}
              </ul>
            )
          )}
        </div>

        <div className="shrink-0 border-t border-line bg-surface px-5 pb-safe pt-3 lg:pb-5">
          <ErrorNote error={confirmRemove ? null : save.error} className="mb-3" />
          <Button
            size="lg"
            className="mb-3 w-full"
            disabled={!selected || selected === current || save.isPending}
            onClick={() => selected && apply(selected)}
          >
            {save.isPending && !confirmRemove && <Loader2 className="size-5 animate-spin" aria-hidden />}
            {selected && selected !== current ? t('exercisedb.picker.select') : t('exercisedb.picker.selectHint')}
          </Button>
        </div>
      </div>

      <ConfirmSheet
        open={confirmRemove}
        title={t('exercisedb.picker.removeTitle')}
        body={t('exercisedb.picker.removeBody')}
        confirmLabel={t('exercisedb.picker.removeConfirm')}
        tone="danger"
        pending={save.isPending}
        error={save.error}
        onConfirm={() => apply(null)}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  )
}

/** Our own media for the movement, never the ExerciseDB GIF: illustration frames, else the body map. */
function OwnMedia({ exercise }: { exercise: PickerExercise }) {
  const own = useMemo(() => exerciseMedia(exercise, { gifFailed: true }), [exercise])
  return (
    <span aria-hidden className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-input)] bg-raised">
      {own.kind === 'frames' ? (
        <Flipbook paths={own.paths} className="size-[88%]" />
      ) : (
        <BodyGlyph target={exercise.target_muscles} secondary={exercise.secondary_muscles} gap="var(--color-raised)" />
      )}
    </span>
  )
}

function CurrentRow({ id, kind, name, pending, onRemove }: { id: string; kind: string; name: string; pending: boolean; onRemove: () => void }) {
  const { t } = useTranslation('admin')
  const url = exerciseDbGifUrl(id)
  const [failed, setFailed] = useState(false)
  return (
    <div className="-mx-5 mt-5 flex items-center gap-3 border-y border-line px-5 py-3">
      <span aria-hidden className="isolate flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-input)] bg-plate">
        {url && !failed ? <ExerciseGif url={url} onError={() => setFailed(true)} crop /> : <Film className="size-5 text-ink-faint" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium leading-snug">{t('exercisedb.picker.current', { kind: t(`exercisedb.kind.${kind}`) })}</span>
        <span className="tabular mt-0.5 block truncate text-[12px] text-ink-faint">{id}</span>
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={onRemove}
        aria-label={t('exercisedb.picker.removeLabel', { name })}
        className="-mr-2 inline-flex h-11 shrink-0 items-center rounded-[var(--radius-button)] px-3 text-[13px] font-semibold text-danger transition-colors hover:bg-raised disabled:text-ink-faint"
      >
        {t('exercisedb.picker.remove')}
      </button>
    </div>
  )
}

function Tile({ hit, selected, current, onSelect }: { hit: ExerciseDbHit; selected: boolean; current: boolean; onSelect: () => void }) {
  const { t } = useTranslation('admin')
  const url = exerciseDbGifUrl(hit.id)
  const [failed, setFailed] = useState(false)
  return (
    <li>
      <button type="button" role="radio" aria-checked={selected} onClick={onSelect} className="group block w-full rounded-[var(--radius-input)] text-left">
        <span
          className={cn(
            'relative isolate flex aspect-square items-center justify-center overflow-hidden rounded-[var(--radius-input)] bg-plate transition-shadow duration-150 ease-out',
            selected ? 'ring-2 ring-volt ring-offset-2 ring-offset-surface' : 'ring-1 ring-line group-hover:ring-line-strong',
          )}
        >
          {url && !failed ? (
            <ExerciseGif url={url} label={t('exercisedb.picker.gifAlt', { name: hit.name })} onError={() => setFailed(true)} className="size-[94%]" />
          ) : (
            <Film className="size-6 text-ink-faint" aria-hidden />
          )}
          {current && (
            <span className="absolute left-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 text-[11px] font-semibold text-bg">{t('exercisedb.picker.currentTag')}</span>
          )}
          {selected && (
            <span aria-hidden className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-volt text-volt-ink">
              <Check className="size-4" strokeWidth={2.5} />
            </span>
          )}
        </span>
        <span className={cn('mt-2 line-clamp-2 block text-[13px] leading-snug first-letter:uppercase', selected ? 'font-semibold text-ink' : 'text-ink-muted')}>
          {hit.name}
        </span>
        <span className="tabular mt-0.5 block text-[11px] text-ink-faint">{hit.id}</span>
      </button>
    </li>
  )
}

function TileSkeleton() {
  return (
    <div aria-busy="true" className="grid grid-cols-2 gap-x-3 gap-y-5">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i}>
          <div className="aspect-square animate-pulse rounded-[var(--radius-input)] bg-raised motion-reduce:animate-none" />
          <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-raised motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  )
}
