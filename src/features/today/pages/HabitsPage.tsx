import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { ArrowLeft, Flame, Plus } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { toLocalDateISO } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useHabitLogs, useHabits } from '../hooks'
import { habitStreak, heatmap, type HeatCell } from '../logic'
import type { Habit, HabitLog } from '../types'
import { describeRule } from '../schedule'
import { HabitSheet } from '../components/Sheets'

/** All habits: streak and a five-week contact sheet each; archived ones folded at the end. */
export function HabitsPage() {
  const { t } = useTranslation('today')
  const habits = useHabits()
  const logs = useHabitLogs()
  const [edit, setEdit] = useState<Habit | 'new' | null>(null)
  const list = habits.data ?? []
  const active = list.filter((h) => !h.archived_at)
  const archived = list.filter((h) => h.archived_at)

  return (
    <PageShell
      title={t('habits.title')}
      leading={
        <div className="flex items-center gap-1">
          <Link to="/track" aria-label={t('form.close')} className="-ml-2 flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink">
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <span className="text-lg font-bold tracking-tight">{t('habits.title')}</span>
        </div>
      }
      actions={
        <Button variant="ghost" size="icon" aria-label={t('habits.add')} title={t('habits.add')} onClick={() => setEdit('new')}>
          <Plus className="size-5" aria-hidden />
        </Button>
      }
    >
      <div className="mx-auto max-w-2xl space-y-4 pb-6">
        <ErrorNote error={habits.error ?? logs.error} />
        {habits.isLoading || logs.isLoading ? (
          <div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none" aria-busy="true" />
        ) : active.length === 0 ? (
          <div className="hairline rounded-[var(--radius-card)] bg-surface px-5 py-6">
            <p className="text-[15px] leading-relaxed text-ink-muted">{t('habits.empty')}</p>
            <Button className="mt-4" onClick={() => setEdit('new')}>
              <Plus className="size-4" aria-hidden />
              {t('habits.add')}
            </Button>
          </div>
        ) : (
          <ul className="space-y-3">
            {active.map((h, i) => (
              <HabitCard key={h.id} habit={h} logs={logs.data ?? []} index={i} onEdit={() => setEdit(h)} />
            ))}
          </ul>
        )}
        {archived.length > 0 && (
          <details className="group">
            <summary className="flex h-11 cursor-pointer list-none items-center px-1 text-[13px] font-medium text-ink-faint hover:text-ink-muted">
              {t('habits.archived')} · {archived.length}
            </summary>
            <ul className="mt-2 space-y-3 opacity-70">
              {archived.map((h, i) => (
                <HabitCard key={h.id} habit={h} logs={logs.data ?? []} index={i} onEdit={() => setEdit(h)} />
              ))}
            </ul>
          </details>
        )}
        <p className="px-1 text-[12px] text-ink-faint">{t('habits.points')}</p>
      </div>
      <HabitSheet open={edit !== null} habit={edit === 'new' ? undefined : (edit ?? undefined)} onClose={() => setEdit(null)} />
    </PageShell>
  )
}

// quiet by default: only done (volt) and partial (volt tint) speak; missed due days are a shade darker than off days
const HEAT: Record<HeatCell['state'], string> = {
  done: 'bg-volt',
  partial: 'bg-volt/35',
  missed: 'bg-raised',
  off: 'bg-raised/45',
  future: 'bg-transparent ring-1 ring-inset ring-line',
  before: 'bg-transparent',
}

function HabitCard({ habit, logs, index, onEdit }: { habit: Habit; logs: HabitLog[]; index: number; onEdit: () => void }) {
  const { t, i18n } = useTranslation('today')
  const today = toLocalDateISO()
  const locale = i18n.resolvedLanguage === 'en' ? enUS : tr
  const cells = useMemo(() => heatmap(habit, logs, today), [habit, logs, today])
  const s = useMemo(() => habitStreak(habit, logs, today), [habit, logs, today])
  const weeks = habit.rule.type === 'weekly_count'
  const days = t('form.weekdays', { returnObjects: true }) as string[]
  return (
    <li className="rise-in" style={{ '--i': index } as React.CSSProperties}>
      <button type="button" onClick={onEdit} className="hairline w-full rounded-[var(--radius-card)] bg-surface p-4 text-left transition-colors hover:bg-raised/40">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-semibold">
              {habit.emoji && <span className="mr-1.5" aria-hidden>{habit.emoji}</span>}
              {habit.name}
            </p>
            <p className="mt-0.5 truncate text-[12px] text-ink-faint">
              {describeRule(habit.rule, t)}
              {habit.target_count > 1 && ` · ${habit.target_count} ${habit.unit ?? ''}`.trimEnd()}
            </p>
          </div>
          <span className={cn('flex shrink-0 items-center gap-1 text-[13px] font-semibold tabular', s > 0 ? 'text-volt' : 'text-ink-faint')}>
            <Flame className="size-4" aria-hidden />
            {s > 0 ? t(weeks ? 'habits.streakWeeks' : 'habits.streak', { count: s }) : t('habits.noStreak')}
          </span>
        </div>
        <div className="mt-4" aria-label={t('habits.heatmap')}>
          <div className="mb-1.5 grid grid-cols-7 gap-1.5">
            {days.map((d) => (
              <span key={d} className="text-center text-[10px] font-medium uppercase text-ink-faint">
                {d}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((c) => (
              <span
                key={c.day}
                title={t(`habits.heat.${c.state}`, { day: format(parseISO(c.day), 'd MMM', { locale }) })}
                className={cn('h-5 rounded-[5px]', HEAT[c.state], c.day === today && 'outline outline-1 outline-offset-1 outline-ink-muted')}
              />
            ))}
          </div>
        </div>
      </button>
    </li>
  )
}
