import { useTranslation } from 'react-i18next'
import { format, parseISO } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { BellRing, Minus, Plus, Repeat } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toLocalDateISO } from '@/lib/dates'
import type { HabitItem, TodoItem } from '../logic'
import { useSetHabitCount, useToggleTodo } from '../hooks'
import { MiniStep, TickButton } from './parts'
import { PRIORITY_DOT, describeRule } from '../schedule'

/** One habit for a day: tick (or +1 for counters), name, progress; tapping the text edits it. */
export function HabitRow({ item, day, onEdit }: { item: HabitItem; day: string; onEdit?: () => void }) {
  const { t } = useTranslation('today')
  const set = useSetHabitCount()
  const { habit, count, done } = item
  const counter = habit.target_count > 1
  const name = habit.name
  const setCount = (n: number) => set.mutate({ habitId: habit.id, day, count: n })
  const meta =
    counter
      ? t('habits.count', { count, target: habit.target_count, unit: habit.unit ?? '' }).trim()
      : habit.rule.type === 'weekly_count'
        ? t('habits.weekProgress', { done: item.weekDone ?? 0, n: habit.rule.n })
        : describeRule(habit.rule, t)

  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-2">
      <TickButton
        done={done}
        progress={counter ? count / habit.target_count : 0}
        label={done ? t('habits.untick', { name }) : counter ? t('habits.inc', { name }) : t('habits.tick', { name })}
        onClick={() => setCount(done ? (counter ? count - 1 : 0) : count + 1)}
      />
      <button type="button" onClick={onEdit} disabled={!onEdit} className="min-w-0 flex-1 text-left">
        <span className={cn('block truncate text-[15px] font-medium transition-colors', done && 'text-ink-muted')}>
          {habit.emoji && <span className="mr-1.5" aria-hidden>{habit.emoji}</span>}
          {name}
        </span>
        <span className={cn('tabular flex min-w-0 items-center gap-1 text-[12px]', done ? 'text-volt' : 'text-ink-faint')}>
          {habit.remind_at && !done && <ReminderMark time={habit.remind_at} sep />}
          <span className="truncate">{meta}</span>
        </span>
      </button>
      {counter && (
        <span className="flex items-center gap-1.5">
          <MiniStep label={t('habits.dec', { name })} disabled={count === 0} onClick={() => setCount(count - 1)}>
            <Minus className="size-4" aria-hidden />
          </MiniStep>
          <MiniStep label={t('habits.inc', { name })} onClick={() => setCount(count + 1)}>
            <Plus className="size-4" aria-hidden />
          </MiniStep>
        </span>
      )}
    </li>
  )
}

/** One to-do occurrence: tick, title, overdue/recurring/priority marks; tapping the text edits it. */
export function TodoRow({ item, onEdit, trailing }: { item: TodoItem; onEdit?: () => void; trailing?: string }) {
  const { t, i18n } = useTranslation('today')
  const toggle = useToggleTodo()
  const { todo, completion, overdue } = item
  const done = Boolean(completion)
  const locale = i18n.resolvedLanguage === 'en' ? enUS : tr
  const title = todo.title
  // a one-off may be ticked before its due day; the completion is then dated today (never in the future)
  const today = toLocalDateISO()
  const tickDay = !todo.rule && item.day > today ? today : item.day
  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-2">
      <TickButton
        done={done}
        label={done ? t('todos.untick', { title }) : t('todos.tick', { title })}
        onClick={() => toggle.mutate({ todoId: todo.id, day: tickDay, completionId: completion?.id })}
      />
      <button type="button" onClick={onEdit} disabled={!onEdit} className="min-w-0 flex-1 text-left">
        <span className={cn('block truncate text-[15px] font-medium', done && 'text-ink-faint line-through decoration-ink-faint/60')}>{title}</span>
        {(overdue || todo.rule || todo.note || todo.remind_at) && (
          <span className={cn('flex min-w-0 items-center gap-1 text-[12px]', overdue ? 'text-danger' : 'text-ink-faint')}>
            {todo.remind_at && !done && <ReminderMark time={todo.remind_at} sep={Boolean(overdue || todo.rule || todo.note)} />}
            {todo.rule && <Repeat className="size-3 shrink-0" aria-hidden />}
            <span className="truncate">
              {overdue ? t('todos.overdue', { date: format(parseISO(item.day), 'd MMM', { locale }) }) : todo.rule ? describeRule(todo.rule, t) : todo.note}
            </span>
          </span>
        )}
      </button>
      {trailing && <span className="tabular shrink-0 text-[12px] text-ink-faint">{trailing}</span>}
      {todo.priority > 0 && !done && <span className={cn('size-2 shrink-0 rounded-full', PRIORITY_DOT[todo.priority])} aria-hidden />}
    </li>
  )
}

/** "🔔 06:52": the item has a reminder (HH:MM, local). */
function ReminderMark({ time, sep }: { time: string; sep: boolean }) {
  const { t } = useTranslation('today')
  return (
    <span className="tabular flex shrink-0 items-center gap-0.5 text-ink-muted" aria-label={`${t('form.reminder')} ${time.slice(0, 5)}`}>
      <BellRing className="size-3" aria-hidden />
      {time.slice(0, 5)}
      {sep && (
        <span aria-hidden className="px-0.5 text-ink-faint/60">
          ·
        </span>
      )}
    </span>
  )
}
