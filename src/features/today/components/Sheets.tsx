import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, ArchiveRestore, BellRing, Loader2, Square, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { BottomSheet } from '@/features/nutrition/components/BottomSheet'
import { Stepper } from '@/features/workouts'
import { toLocalDateISO } from '@/lib/dates'
import { addDays, type RecurrenceRule } from '@/lib/recurrence'
import { cn } from '@/lib/utils'
import { useArchiveHabit, useDeleteHabit, useDeleteTodo, useSaveHabit, useSaveTodo, useStopTodo } from '../hooks'
import type { Habit, Priority, Todo } from '../types'
import { Chip, RulePicker } from './RulePicker'
import { usePushState } from '@/features/notifications/hooks'

const field = 'hairline h-12 w-full rounded-[var(--radius-input)] bg-bg px-3 text-[16px] text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-volt'
const label = 'mb-1.5 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint'

/** Add or edit a habit. `habit` undefined = new. */
export function HabitSheet({ open, habit, onClose }: { open: boolean; habit?: Habit; onClose: () => void }) {
  const { t } = useTranslation('today')
  const save = useSaveHabit()
  const archive = useArchiveHabit()
  const del = useDeleteHabit()
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [rule, setRule] = useState<RecurrenceRule>({ type: 'daily' })
  const [counter, setCounter] = useState(false)
  const [target, setTarget] = useState<number | null>(8)
  const [unit, setUnit] = useState('')
  const [remind, setRemind] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(habit?.name ?? '')
    setEmoji(habit?.emoji ?? '')
    setRule(habit?.rule ?? { type: 'daily' })
    setCounter((habit?.target_count ?? 1) > 1)
    setTarget(habit && habit.target_count > 1 ? habit.target_count : 8)
    setUnit(habit?.unit ?? '')
    setRemind(habit?.remind_at?.slice(0, 5) ?? null)
    save.reset()
  }, [open, habit])

  const ok = name.trim().length > 0 && (!counter || (target ?? 0) > 1)
  const submit = () =>
    save.mutate(
      {
        id: habit?.id,
        input: {
          name: name.trim(),
          emoji: emoji.trim() || null,
          rule,
          target_count: counter ? (target ?? 1) : 1,
          unit: counter ? unit.trim() || null : null,
          remind_at: remind,
        },
      },
      { onSuccess: onClose },
    )

  return (
    <BottomSheet open={open} label={habit ? t('habits.edit') : t('habits.add')} closeLabel={t('form.close')} onClose={onClose}>
      <div className="space-y-5 pb-5">
        <h2 className="display text-[24px]">{habit ? t('habits.edit') : t('habits.add')}</h2>
        <div className="grid grid-cols-[1fr_72px] gap-2">
          <label className="block">
            <span className={label}>{t('form.name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t('form.namePlaceholder')} className={field} />
          </label>
          <label className="block">
            <span className={label}>{t('form.emoji')}</span>
            <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} placeholder="📖" className={cn(field, 'text-center')} />
          </label>
        </div>
        <div>
          <span className={label}>{t('form.schedule')}</span>
          <RulePicker value={rule} onChange={(r) => r && setRule(r)} kinds={['daily', 'weekly', 'weekly_count', 'every']} />
        </div>
        <div className="space-y-3">
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" checked={counter} onChange={(e) => setCounter(e.target.checked)} className="size-5 accent-[var(--color-volt)]" />
            <span>
              <span className="block text-[15px] font-medium">{t('form.counter')}</span>
              <span className="block text-[12px] text-ink-faint">{t('form.counterHint')}</span>
            </span>
          </label>
          {counter && (
            <div className="grid grid-cols-[1fr_120px] items-end gap-3">
              <Stepper label={t('form.target')} value={target} onChange={setTarget} step={1} min={2} max={999} size="sm" decLabel={t('form.dec')} incLabel={t('form.inc')} />
              <label className="block">
                <span className={label}>{t('form.unit')}</span>
                <input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={16} placeholder={t('form.unitPlaceholder')} className={field} />
              </label>
            </div>
          )}
        </div>
        <ReminderField value={remind} onChange={setRemind} />
        <ErrorNote error={save.error ?? archive.error ?? del.error} />
        <div className="grid gap-2">
          <Button size="lg" disabled={!ok || save.isPending} onClick={submit}>
            {save.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
            {habit ? t('form.save') : t('form.create')}
          </Button>
          {habit && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={archive.isPending} onClick={() => archive.mutate({ id: habit.id, archived: !habit.archived_at }, { onSuccess: onClose })}>
                {habit.archived_at ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
                {habit.archived_at ? t('habits.unarchive') : t('habits.archive')}
              </Button>
              <Button
                variant="ghost"
                className="text-danger hover:text-danger"
                disabled={del.isPending}
                onClick={() => window.confirm(t('habits.deleteConfirm')) && del.mutate(habit.id, { onSuccess: onClose })}
              >
                <Trash2 className="size-4" aria-hidden />
                {t('habits.delete')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </BottomSheet>
  )
}

/** Add or edit a to-do. `defaultDay` pre-selects the due day when adding from a calendar day. */
export function TodoSheet({ open, todo, defaultDay, onClose }: { open: boolean; todo?: Todo; defaultDay?: string; onClose: () => void }) {
  const { t } = useTranslation('today')
  const save = useSaveTodo()
  const stop = useStopTodo()
  const del = useDeleteTodo()
  const today = toLocalDateISO()
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [priority, setPriority] = useState<Priority>(0)
  const [due, setDue] = useState<string | null>(null)
  const [rule, setRule] = useState<RecurrenceRule | null>(null)
  const [remind, setRemind] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle(todo?.title ?? '')
    setNote(todo?.note ?? '')
    setPriority((todo?.priority ?? 0) as Priority)
    setDue(todo ? (todo.rule ? todo.starts_on : todo.due_on) : (defaultDay ?? today))
    setRule(todo?.rule ?? null)
    setRemind(todo?.remind_at?.slice(0, 5) ?? null)
    save.reset()
  }, [open, todo, defaultDay])

  const priorities = t('form.priorities', { returnObjects: true }) as string[]
  const tomorrow = addDays(today, 1)
  const ok = title.trim().length > 0
  const submit = () =>
    save.mutate(
      { id: todo?.id, input: { title: title.trim(), note: note.trim() || null, priority, due_on: rule ? (due ?? today) : due, rule, remind_at: rule || due ? remind : null } },
      { onSuccess: onClose },
    )

  return (
    <BottomSheet open={open} label={todo ? t('todos.edit') : t('todos.add')} closeLabel={t('form.close')} onClose={onClose}>
      <div className="space-y-5 pb-5">
        <h2 className="display text-[24px]">{todo ? t('todos.edit') : t('todos.add')}</h2>
        <label className="block">
          <span className={label}>{t('form.title')}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={t('form.titlePlaceholder')} className={field} />
        </label>
        <div>
          <span className={label}>{rule ? t('form.startsOn') : t('form.due')}</span>
          <div className="flex flex-wrap items-center gap-2">
            {!rule && <Chip active={due === null} onClick={() => setDue(null)}>{t('form.dueNone')}</Chip>}
            <Chip active={due === today} onClick={() => setDue(today)}>{t('form.dueToday')}</Chip>
            <Chip active={due === tomorrow} onClick={() => setDue(tomorrow)}>{t('form.dueTomorrow')}</Chip>
            <input
              type="date"
              aria-label={t('form.duePick')}
              value={due ?? ''}
              onChange={(e) => setDue(e.target.value || null)}
              className="hairline h-10 rounded-full bg-bg px-3 text-[14px] text-ink-muted"
            />
          </div>
        </div>
        <div>
          <span className={label}>{t('form.repeat')}</span>
          <RulePicker value={rule} onChange={setRule} kinds={['none', 'daily', 'weekly', 'monthly', 'every']} />
        </div>
        <div>
          <span className={label}>{t('form.priority')}</span>
          <div className="flex gap-2">
            {priorities.map((p, i) => (
              <Chip key={p} active={priority === i} onClick={() => setPriority(i as Priority)}>
                {p}
              </Chip>
            ))}
          </div>
        </div>
        <label className="block">
          <span className={label}>{t('form.note')}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} className={cn(field, 'h-auto py-2.5')} />
        </label>
        <ReminderField value={remind} onChange={setRemind} disabledHint={!rule && !due ? t('form.reminderNeedsDay') : undefined} />
        <ErrorNote error={save.error ?? stop.error ?? del.error} />
        <div className="grid gap-2">
          <Button size="lg" disabled={!ok || save.isPending} onClick={submit}>
            {save.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
            {todo ? t('form.save') : t('form.create')}
          </Button>
          {todo && (
            <div className={cn('grid gap-2', todo.rule && !todo.archived_at && 'grid-cols-2')}>
              {todo.rule && !todo.archived_at && (
                <Button variant="secondary" disabled={stop.isPending} onClick={() => stop.mutate(todo.id, { onSuccess: onClose })}>
                  <Square className="size-4" aria-hidden />
                  {t('todos.stop')}
                </Button>
              )}
              <Button
                variant="ghost"
                className="text-danger hover:text-danger"
                disabled={del.isPending}
                onClick={() => window.confirm(t('todos.deleteConfirm')) && del.mutate(todo.id, { onSuccess: onClose })}
              >
                <Trash2 className="size-4" aria-hidden />
                {t('todos.delete')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </BottomSheet>
  )
}

/** Optional reminder time (local). Shows how to turn notifications on when this device has them off. */
function ReminderField({ value, onChange, disabledHint }: { value: string | null; onChange: (v: string | null) => void; disabledHint?: string }) {
  const { t } = useTranslation('today')
  const push = usePushState()
  const offHere = push.data?.configured && !push.data.enabled
  if (!push.data?.configured) return null
  return (
    <div>
      <span className={label}>{t('form.reminder')}</span>
      {disabledHint ? (
        <p className="text-[13px] text-ink-faint">{disabledHint}</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <label className="hairline flex h-11 items-center gap-2 rounded-full bg-bg pl-3 pr-1 text-[14px]">
              <BellRing className={cn('size-4', value ? 'text-volt' : 'text-ink-faint')} aria-hidden />
              <input
                type="time"
                aria-label={t('form.reminder')}
                value={value ?? ''}
                onChange={(e) => onChange(e.target.value || null)}
                className="h-10 bg-transparent pr-2 text-[15px] text-ink outline-none"
              />
            </label>
            {value && (
              <button type="button" onClick={() => onChange(null)} aria-label={t('form.reminderClear')} className="flex size-11 items-center justify-center rounded-full text-ink-faint hover:text-ink">
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>
          {value && offHere && <p className="mt-1.5 text-[12px] leading-snug text-ink-faint">{t('form.reminderHint')}</p>}
        </>
      )}
    </div>
  )
}
