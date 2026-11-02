import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Film, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { PLAIN_LIST } from '@/components/ui/GroupedList'
import { SectionTabs } from '@/components/ui/SectionTabs'
import { exerciseName, ExerciseThumb, useVocab } from '@/features/exercises'
import { cn } from '@/lib/utils'
import { AdminFrame } from '../components/AdminFrame'
import { ExerciseMediaPicker } from '../components/ExerciseMediaPicker'
import { LIMITS } from '../adminLogic'
import type { MatchList, MatchRow } from '../api'
import { matchSummary, type MatchKind } from '../exercisedbLogic'
import { useExerciseDbMatchCounts, useMatchRows } from '../hooks'

const LISTS = ['unmatched', 'ai'] as const satisfies readonly MatchList[]

/** Segment colours: matched kinds in steps of the one accent, the empty track is "unmatched". */
const SEGMENT: Record<Exclude<MatchKind, 'unmatched'>, string> = {
  exact: 'bg-volt',
  fuzzy: 'bg-volt/60',
  ai: 'bg-volt/35',
  manual: 'bg-ink-faint',
}

/**
 * Catalog exercises the sync could not match to an ExerciseDB animation (they show their illustration
 * frames or the body map instead). Point of view: a coverage gauge, then the worklist. The big number is
 * what is left to fix; one segmented bar shows how the rest was matched; flat rows open the picker
 * (ExerciseMediaPicker), where the admin chooses the animation by hand. A second list reviews AI matches.
 */
export function ExerciseDbPage() {
  const { t, i18n } = useTranslation('admin')
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<MatchList>('unmatched')
  const [picking, setPicking] = useState<MatchRow | null>(null)
  const counts = useExerciseDbMatchCounts()
  const list = useMatchRows(tab, query)
  const summary = useMemo(() => matchSummary(counts.data), [counts.data])

  useEffect(() => {
    const id = window.setTimeout(() => setQuery(input.trim().slice(0, LIMITS.query)), 300)
    return () => window.clearTimeout(id)
  }, [input])

  const rows = list.data?.pages.flatMap((p) => p.rows) ?? []
  const total = list.data?.pages[0]?.total ?? 0
  const pct = new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 0 }).format(summary.coverage)
  const num = (n: number) => new Intl.NumberFormat(i18n.language).format(n)

  return (
    <AdminFrame title={t('exercisedb.title')}>
      <ErrorNote error={counts.error} className="mb-4" />
      {counts.data && (
        <header className="rise-in space-y-4 pb-7 pt-2">
          <div className="space-y-1">
            <p className="eyebrow">{t('exercisedb.eyebrow')}</p>
            <p className="display tabular text-[56px] leading-none">{num(summary.unmatched)}</p>
            <p className="text-[15px] text-ink-muted">{t('exercisedb.ofTotal', { total: num(summary.total), coverage: pct })}</p>
          </div>
          <div
            role="img"
            aria-label={t('exercisedb.barLabel', {
              detail: summary.segments.map((s) => `${t(`exercisedb.kind.${s.kind}`)} ${num(s.count)}`).join(', '),
            })}
            className="flex h-1.5 gap-px overflow-hidden rounded-full bg-raised"
          >
            {summary.segments
              .filter((s) => s.kind !== 'unmatched')
              .map((s) => (
                <span key={s.kind} className={cn('h-full', SEGMENT[s.kind as keyof typeof SEGMENT])} style={{ width: `${s.ratio * 100}%` }} />
              ))}
          </div>
          <ul aria-hidden className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-muted">
            {(['exact', 'fuzzy', 'ai', 'manual'] as const).map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span className={cn('size-2 rounded-full', SEGMENT[k])} />
                {t(`exercisedb.kind.${k}`)}
                <span className="tabular text-ink">{num(counts.data[k] ?? 0)}</span>
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <span className="hairline size-2 rounded-full bg-raised" />
              {t('exercisedb.kind.unmatched')}
              <span className="tabular text-ink">{num(summary.unmatched)}</span>
            </li>
          </ul>
        </header>
      )}

      <SectionTabs
        label={t('exercisedb.tabs.label')}
        options={LISTS}
        value={tab}
        onChange={setTab}
        labelOf={(v) => t(`exercisedb.tabs.${v}`)}
        className="mb-3"
      />

      <form role="search" onSubmit={(e: FormEvent) => e.preventDefault()} className="relative mb-2">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
        <input
          type="search"
          enterKeyHint="search"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={input}
          maxLength={LIMITS.query}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('exercisedb.search')}
          aria-label={t('exercisedb.search')}
          className="hairline h-12 w-full rounded-full bg-surface pl-10 pr-4 text-[16px] text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-volt"
        />
        {list.isFetching && !list.isFetchingNextPage && (
          <Loader2 className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-faint" aria-hidden />
        )}
      </form>
      <p className="tabular mb-4 px-1 text-[12px] text-ink-faint" aria-live="polite">
        {list.data && total > 0
          ? query
            ? t('exercisedb.found', { count: total })
            : t(tab === 'ai' ? 'exercisedb.aiCount' : 'exercisedb.count', { count: total })
          : ' '}
      </p>

      <ErrorNote error={list.error} className="mb-4" />

      {list.isLoading ? (
        <div className="hairline h-64 animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none" aria-busy="true" />
      ) : list.data && rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-ink-faint">
          <Film className="size-8" aria-hidden />
          <p className="max-w-[32ch] text-sm">
            {query ? t(tab === 'ai' ? 'exercisedb.aiEmptySearch' : 'exercisedb.emptySearch') : t(tab === 'ai' ? 'exercisedb.aiEmpty' : 'exercisedb.empty')}
          </p>
        </div>
      ) : (
        <ul className={PLAIN_LIST}>
          {rows.map((r) => (
            <Row key={r.id} row={r} withThumb={tab === 'ai'} onOpen={() => setPicking(r)} />
          ))}
        </ul>
      )}

      {list.hasNextPage && (
        <Button variant="secondary" size="lg" className="mt-5 w-full" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          {list.isFetchingNextPage && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('exercisedb.more', { count: num(total - rows.length) })}
        </Button>
      )}

      <p className="mt-6 px-1 text-[12px] leading-relaxed text-ink-faint">{t('exercisedb.note')}</p>

      <ExerciseMediaPicker exercise={picking} onClose={() => setPicking(null)} />
    </AdminFrame>
  )
}

/** One worklist row; the button opens the picker. AI matches lead with their GIF to judge at a glance. */
function Row({ row, withThumb, onOpen }: { row: MatchRow; withThumb: boolean; onOpen: () => void }) {
  const vocab = useVocab()
  const meta = [...row.body_parts.map(vocab.bodyPart), ...row.equipment.map(vocab.equipment)].join(' · ')
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised/50 lg:px-0"
      >
        {withThumb && <ExerciseThumb exercise={row} size={48} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium leading-snug">{exerciseName(row)}</span>
          {meta && <span className="mt-0.5 block truncate text-[12px] text-ink-faint">{meta}</span>}
        </span>
        <span className="shrink-0 text-[12px] text-ink-muted">{row.source}</span>
        <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
      </button>
    </li>
  )
}
