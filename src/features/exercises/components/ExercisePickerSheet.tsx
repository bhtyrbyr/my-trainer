import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { useExerciseSearch } from '../hooks'
import { exerciseName } from '../name'
import type { Exercise } from '../types'
import { ExerciseThumb } from './ExerciseThumb'

type Props = {
  open: boolean
  onClose: () => void
  onPick: (exercise: Exercise) => void
  /** ids already in the list; shown as selected and not pickable twice */
  selectedIds?: string[]
  title?: string
}

/** Full-screen search sheet used by templates and the live session to add an exercise. */
export function ExercisePickerSheet({ open, onClose, onPick, selectedIds = [], title }: Props) {
  const { t, i18n } = useTranslation('exercises')
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const id = window.setTimeout(() => setQ(input), 250)
    return () => window.clearTimeout(id)
  }, [input])

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  const filters = useMemo(() => ({ q }), [q])
  const search = useExerciseSearch(filters)
  const items = search.data?.pages.flat() ?? []
  const selected = new Set(selectedIds)

  if (!open) return null

  return (
    <div role="dialog" aria-modal="true" aria-label={title ?? t('picker.title')} className="fixed inset-0 z-50 flex flex-col bg-bg pt-safe pb-safe">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <div className="hairline flex h-11 flex-1 items-center gap-2 rounded-[var(--radius-input)] bg-surface px-3">
          <Search className="size-4 text-ink-faint" aria-hidden />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('picker.searchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-[16px] text-ink placeholder:text-ink-faint focus:outline-none"
            enterKeyHint="search"
          />
        </div>
        <Button variant="ghost" size="icon" aria-label={t('picker.close')} onClick={onClose}>
          <X className="size-5" aria-hidden />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <ErrorNote error={search.error} className="mb-3" />
        <ul className="divide-y divide-line">
          {items.map((ex) => {
            const isSelected = selected.has(ex.id)
            return (
              <li key={ex.id}>
                <button
                  type="button"
                  disabled={isSelected}
                  onClick={() => onPick(ex)}
                  className="flex w-full items-center gap-3 py-2.5 text-left disabled:opacity-40"
                >
                  <ExerciseThumb gifPath={ex.gif_path} size={48} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{exerciseName(ex, i18n.resolvedLanguage)}</span>
                    <span className="block truncate text-xs text-ink-faint">
                      {[...ex.target_muscles, ...ex.equipment].join(' · ')}
                    </span>
                  </span>
                  {isSelected && <span className="text-xs text-ink-faint">{t('picker.added')}</span>}
                </button>
              </li>
            )
          })}
        </ul>
        {search.isLoading && (
          <p className="flex justify-center py-8 text-ink-faint">
            <Loader2 className="size-5 animate-spin" aria-hidden />
          </p>
        )}
        {!search.isLoading && items.length === 0 && <p className="py-12 text-center text-sm text-ink-faint">{t('picker.empty')}</p>}
        {search.hasNextPage && (
          <Button variant="secondary" className="mt-3 w-full" disabled={search.isFetchingNextPage} onClick={() => void search.fetchNextPage()}>
            {search.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" aria-hidden /> : t('picker.more')}
          </Button>
        )}
      </div>
    </div>
  )
}
