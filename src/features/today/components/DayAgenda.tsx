import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { toLocalDateISO } from '@/lib/dates'
import { useHabitLogs, useHabits, useTodos } from '../hooks'
import { habitsFor, todosFor } from '../logic'
import type { Habit, Todo } from '../types'
import { HabitRow, TodoRow } from './Rows'
import { HabitSheet, TodoSheet } from './Sheets'

/**
 * Track day view: the day's habits, then its to-dos (today also carries overdue ones). One card, one
 * hairline between the two lists, quick adds at the foot.
 */
export function DayAgenda({ day }: { day: string }) {
  const { t } = useTranslation('today')
  const today = toLocalDateISO()
  const habits = useHabits()
  const logs = useHabitLogs()
  const todos = useTodos()
  const [editHabit, setEditHabit] = useState<Habit | 'new' | null>(null)
  const [editTodo, setEditTodo] = useState<Todo | 'new' | null>(null)

  const habitItems = useMemo(() => habitsFor(day, habits.data ?? [], logs.data ?? []), [day, habits.data, logs.data])
  const todoItems = useMemo(() => todosFor(day, today, todos.data?.todos ?? [], todos.data?.completions ?? []), [day, today, todos.data])
  const loading = habits.isLoading || logs.isLoading || todos.isLoading
  const doneCount = habitItems.filter((h) => h.done).length + todoItems.filter((i) => i.completion).length
  const total = habitItems.length + todoItems.length

  return (
    <section aria-label={t('section')} className="hairline overflow-hidden rounded-[var(--radius-card)] bg-surface">
      <header className="flex items-center justify-between px-4 pb-1 pt-4">
        <p className="eyebrow">{t('section')}</p>
        {total > 0 && (
          <span className="tabular text-[12px] font-medium text-ink-faint">
            {doneCount}/{total}
          </span>
        )}
      </header>
      <ErrorNote error={habits.error ?? logs.error ?? todos.error} className="mx-4 my-2" />
      {loading ? (
        <div className="mx-4 my-3 h-28 animate-pulse rounded-[var(--radius-input)] bg-raised motion-reduce:animate-none" aria-busy="true" />
      ) : total === 0 ? (
        <p className="px-4 py-4 text-[14px] text-ink-faint">{t('day.empty')}</p>
      ) : (
        <>
          {habitItems.length > 0 && (
            <ul className="divide-y divide-line">
              {habitItems.map((item) => (
                <HabitRow key={item.habit.id} item={item} day={day} onEdit={() => setEditHabit(item.habit)} />
              ))}
            </ul>
          )}
          {habitItems.length > 0 && todoItems.length > 0 && <div className="mx-4 border-t border-line-strong" />}
          {todoItems.length > 0 && (
            <ul className="divide-y divide-line">
              {todoItems.map((item) => (
                <TodoRow key={`${item.todo.id}:${item.day}`} item={item} onEdit={() => setEditTodo(item.todo)} />
              ))}
            </ul>
          )}
        </>
      )}
      <footer className="flex items-center border-t border-line px-2 py-1">
        <QuickAdd onClick={() => setEditHabit('new')}>{t('day.addHabit')}</QuickAdd>
        <QuickAdd onClick={() => setEditTodo('new')}>{t('day.addTodo')}</QuickAdd>
        <span className="flex-1" />
        <Link to="/track/habits" className="flex h-11 items-center px-2 text-[13px] font-medium text-ink-muted hover:text-ink">
          {t('habits.manage')}
        </Link>
        <span className="text-ink-faint/50" aria-hidden>
          ·
        </span>
        <Link to="/track/todos" className="flex h-11 items-center px-2 text-[13px] font-medium text-ink-muted hover:text-ink">
          {t('todos.manage')}
        </Link>
      </footer>
      <HabitSheet open={editHabit !== null} habit={editHabit === 'new' ? undefined : (editHabit ?? undefined)} onClose={() => setEditHabit(null)} />
      <TodoSheet open={editTodo !== null} todo={editTodo === 'new' ? undefined : (editTodo ?? undefined)} defaultDay={day} onClose={() => setEditTodo(null)} />
    </section>
  )
}

function QuickAdd({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex h-11 items-center gap-0.5 rounded-full px-2 text-[13px] font-semibold text-volt hover:bg-raised">
      <Plus className="size-4" aria-hidden />
      {children}
    </button>
  )
}
