import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { exerciseName } from '@/features/exercises'
import { useSaveProgramDays, type ProgramCardData } from '../hooks'
import { useCoachBase } from '../previewContext'

/**
 * A suggested program as a training sheet: one ruled surface, days as numbered sections, sets x reps
 * in tabular figures. Each day saves as its own template ("<program> - <day>"); "Save all" saves the
 * rest. Saved days stay marked for this session.
 */
export function ProgramCard({ data }: { data: ProgramCardData }) {
  const { t, i18n } = useTranslation('coach')
  const base = useCoachBase()
  const save = useSaveProgramDays()
  const [saved, setSaved] = useState<Set<number>>(() => new Set())
  const [busyDay, setBusyDay] = useState<number | 'all' | null>(null)
  const [toast, setToast] = useState<number | null>(null)
  const { program, unmatched } = data
  const unsaved = program.days.map((_, i) => i).filter((i) => !saved.has(i))

  useEffect(() => {
    if (toast === null) return
    const timer = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(timer)
  }, [toast])

  const run = (days: number[], which: number | 'all') => {
    if (!days.length || save.isPending) return
    setBusyDay(which)
    save.mutate(
      { program, days },
      {
        onSuccess: (done) => {
          setSaved((prev) => new Set([...prev, ...done]))
          setToast(done.length)
        },
        onSettled: () => setBusyDay(null),
      },
    )
  }

  return (
    <div className="hairline max-w-full overflow-hidden rounded-[20px] rounded-tl-[6px] bg-surface">
      <header className="px-4 pb-3 pt-4">
        <p className="eyebrow">{t('program.eyebrow')}</p>
        <h3 className="display mt-1.5 text-[22px] leading-tight text-ink">{program.name}</h3>
        <p className="tabular mt-1 text-[13px] text-ink-faint">
          {t('program.days', { count: program.days.length })} · {t('program.exercises', { count: program.days.reduce((n, d) => n + d.exercises.length, 0) })}
        </p>
      </header>

      <ol className="divide-y divide-line border-t border-line">
        {program.days.map((day, i) => {
          const isSaved = saved.has(i)
          return (
            <li key={i} className="px-4 pb-2 pt-3">
              <div className="flex items-center gap-3">
                <span aria-hidden className="display tabular w-7 shrink-0 text-[20px] text-ink-faint">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h4 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{day.name}</h4>
                {isSaved ? (
                  <span className="flex h-11 items-center gap-1.5 text-[13px] font-medium text-ink-muted">
                    <Check className="size-4 text-volt" aria-hidden />
                    {t('program.saved')}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={save.isPending}
                    onClick={() => run([i], i)}
                    aria-label={t('program.saveDayLabel', { day: day.name })}
                    className="-mr-2 flex h-11 items-center gap-1.5 rounded-full px-2 text-[13px] font-semibold text-ink-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
                  >
                    {busyDay === i ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
                    {t('program.saveDay')}
                  </button>
                )}
              </div>
              <ul className="pb-1 pl-10">
                {day.exercises.map((ex) => (
                  <li key={ex.exercise_id} className="flex items-baseline gap-3 py-1 text-[14px]">
                    <span className="min-w-0 flex-1 text-ink-muted">{exerciseName(ex, i18n.resolvedLanguage)}</span>
                    <span className="tabular shrink-0 font-semibold text-ink">{t('program.setsReps', { sets: ex.sets, reps: ex.reps })}</span>
                    <span className="tabular w-10 shrink-0 text-right text-[12px] text-ink-faint">{t('program.rest', { sec: ex.rest_sec })}</span>
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ol>

      <footer className="space-y-3 border-t border-line px-4 py-4">
        {program.notes && <p className="text-[13px] leading-relaxed text-ink-muted">{program.notes}</p>}
        {unmatched.length > 0 && <p className="text-[12px] leading-snug text-ink-faint">{t('program.skipped', { names: unmatched.join(', ') })}</p>}
        <ErrorNote error={save.error} />
        {unsaved.length > 0 ? (
          <Button className="w-full" disabled={save.isPending} onClick={() => run(unsaved, 'all')}>
            {busyDay === 'all' && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {unsaved.length === program.days.length ? t('program.saveAll') : t('program.saveRest', { count: unsaved.length })}
          </Button>
        ) : (
          <Link
            to={`${base}/workouts`}
            className="flex h-11 items-center justify-center gap-1.5 rounded-[var(--radius-button)] bg-raised text-[15px] font-semibold text-ink hover:bg-raised/70"
          >
            {t('program.toWorkouts')}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        )}
      </footer>

      {/* portal: the thread items animate with transforms, which would trap a fixed element */}
      {createPortal(
        <div aria-live="polite">
          {toast !== null && (
            <div className="rise-in hairline fixed inset-x-4 bottom-[calc(var(--nav-h)+var(--sab)+6.5rem)] z-30 mx-auto flex max-w-md items-center gap-3 rounded-[var(--radius-card)] bg-raised py-1.5 pl-4 pr-1.5 lg:bottom-28">
              <Check className="size-4 shrink-0 text-volt" aria-hidden />
              <p className="min-w-0 flex-1 text-[14px] font-medium text-ink">{t('program.toast', { count: toast })}</p>
              <Link to={`${base}/workouts`} className="flex h-11 shrink-0 items-center gap-1 rounded-full px-3 text-[14px] font-semibold text-volt hover:bg-surface">
                {t('program.toastLink')}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
