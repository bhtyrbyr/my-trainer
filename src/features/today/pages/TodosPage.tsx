import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { ArrowLeft, Plus, Repeat } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { toLocalDateISO } from '@/lib/dates'
import { useTodos } from '../hooks'
import { groupTodos, type TodoItem } from '../logic'
import type { Todo } from '../types'
import { TodoRow } from '../components/Rows'
import { describeRule } from '../schedule'
import { TodoSheet } from '../components/Sheets'

/** Every to-do by when it is due; recurring ones as templates; the last 30 days of done ones. */
export function TodosPage() {
  const { t, i18n } = useTranslation('today')
  const today = toLocalDateISO()
  const todos = useTodos()
  const [edit, setEdit] = useState<Todo | 'new' | null>(null)
  const g = useMemo(() => groupTodos(todos.data?.todos ?? [], todos.data?.completions ?? [], today), [todos.data, today])
  const locale = i18n.resolvedLanguage === 'en' ? enUS : tr
  const empty = !g.overdue.length && !g.today.length && !g.upcoming.length && !g.someday.length && !g.recurring.length && !g.done.length

  const group = (key: 'overdue' | 'today' | 'upcoming' | 'someday' | 'done', items: TodoItem[]) =>
    items.length > 0 && (
      <section key={key} aria-label={t(`todos.groups.${key}`)}>
        <h2 className={key === 'overdue' ? 'eyebrow mb-2 px-1 text-danger' : 'eyebrow mb-2 px-1'}>{t(`todos.groups.${key}`)}</h2>
        <ul className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
          {items.map((item) =>
            key === 'upcoming' ? (
              <TodoRow key={item.todo.id} item={item} trailing={format(parseISO(item.day), 'EEE d MMM', { locale })} onEdit={() => setEdit(item.todo)} />
            ) : (
              <TodoRow key={item.todo.id} item={item} onEdit={() => setEdit(item.todo)} />
            ),
          )}
        </ul>
      </section>
    )

  return (
    <PageShell
      title={t('todos.title')}
      leading={
        <div className="flex items-center gap-1">
          <Link to="/track" aria-label={t('form.close')} className="-ml-2 flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink">
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <span className="text-lg font-bold tracking-tight">{t('todos.title')}</span>
        </div>
      }
      actions={
        <Button variant="ghost" size="icon" aria-label={t('todos.add')} title={t('todos.add')} onClick={() => setEdit('new')}>
          <Plus className="size-5" aria-hidden />
        </Button>
      }
    >
      <div className="mx-auto max-w-2xl space-y-6 pb-6">
        <ErrorNote error={todos.error} />
        {todos.isLoading ? (
          <div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none" aria-busy="true" />
        ) : empty ? (
          <div className="hairline rounded-[var(--radius-card)] bg-surface px-5 py-6">
            <p className="text-[15px] leading-relaxed text-ink-muted">{t('todos.empty')}</p>
            <Button className="mt-4" onClick={() => setEdit('new')}>
              <Plus className="size-4" aria-hidden />
              {t('todos.add')}
            </Button>
          </div>
        ) : (
          <>
            {group('overdue', g.overdue)}
            {group('today', g.today)}
            {group('upcoming', g.upcoming)}
            {group('someday', g.someday)}
            {g.recurring.length > 0 && (
              <section aria-label={t('todos.groups.recurring')}>
                <h2 className="eyebrow mb-2 px-1">{t('todos.groups.recurring')}</h2>
                <ul className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
                  {g.recurring.map((todo) => (
                    <li key={todo.id}>
                      <button type="button" onClick={() => setEdit(todo)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-raised/40">
                        <Repeat className="size-4 shrink-0 text-ink-faint" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-medium">{todo.title}</span>
                          <span className="block truncate text-[12px] text-ink-faint">{todo.rule && describeRule(todo.rule, t)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {group('done', g.done)}
          </>
        )}
        <p className="px-1 text-[12px] text-ink-faint">{t('todos.points')}</p>
      </div>
      <TodoSheet open={edit !== null} todo={edit === 'new' ? undefined : (edit ?? undefined)} onClose={() => setEdit(null)} />
    </PageShell>
  )
}
