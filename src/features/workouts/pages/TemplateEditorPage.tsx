import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, Loader2, Plus, Trash2 } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { ExercisePickerSheet, ExerciseThumb, exerciseName, useExercisesByIds, type Exercise } from '@/features/exercises'
import { cn } from '@/lib/utils'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { Stepper } from '../components/Stepper'
import { WeekdayPicker } from '../components/WeekdayChips'
import { useArchiveTemplate, useSaveTemplate, useTemplate } from '../hooks'
import { DEFAULT_REST_SEC, estimateDurationSec, formatClock, normalizeWeekdays, roundMinutes } from '../logic'
import { useIsPreview } from '../previewContext'
import { templateInput, type TemplateExerciseInput, type TemplateWithExercises } from '../schema'

export function TemplateEditorPage() {
  const { id } = useParams()
  const { t } = useTranslation('workouts')
  const query = useTemplate(id)
  if (id && query.isLoading) {
    return (
      <PageShell title={t('editor.editTitle')}>
        <div className="h-64 animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none" />
      </PageShell>
    )
  }
  if (id && !query.data) {
    return (
      <PageShell title={t('editor.editTitle')}>
        <ErrorNote error={query.error ?? { code: 'PGRST116' }} />
      </PageShell>
    )
  }
  return <TemplateForm key={id ?? 'new'} template={query.data ?? null} />
}

const newId = () => crypto.randomUUID()

type Item = TemplateExerciseInput

/**
 * Plan editor. Point of view: a setlist. Each exercise is one numbered row that opens into four steppers;
 * the order is the plan, so moving rows is explicit (up/down) rather than a fiddly drag on a phone.
 */
export function TemplateForm({ template }: { template: TemplateWithExercises | null }) {
  const { t, i18n } = useTranslation('workouts')
  const navigate = useNavigate()
  const preview = useIsPreview()
  const save = useSaveTemplate()
  const archive = useArchiveTemplate()
  const [name, setName] = useState(template?.name ?? '')
  const [weekdays, setWeekdays] = useState<number[]>(normalizeWeekdays(template?.weekdays))
  const [items, setItems] = useState<Item[]>(
    (template?.template_exercises ?? []).map((te) => ({
      id: te.id,
      exercise_id: te.exercise_id,
      target_sets: te.target_sets,
      target_reps_low: te.target_reps_low,
      target_reps_high: te.target_reps_high,
      rest_seconds: te.rest_seconds,
    })),
  )
  const [open, setOpen] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [picked, setPicked] = useState<Map<string, Exercise>>(new Map())
  const [validation, setValidation] = useState<string | null>(null)

  const ids = useMemo(() => [...new Set(items.map((i) => i.exercise_id))], [items])
  const loaded = useExercisesByIds(ids)
  const byId = useMemo(() => {
    const m = new Map(picked)
    for (const e of loaded.data ?? []) m.set(e.id, e)
    return m
  }, [loaded.data, picked])

  const backTo = preview ? '/__dev/workouts' : '/workouts'
  const minutes = roundMinutes(estimateDurationSec(items))

  const update = (id: string, patch: Partial<Item>) =>
    setItems((list) =>
      list.map((it) => {
        if (it.id !== id) return it
        const next = { ...it, ...patch }
        if (patch.target_reps_low !== undefined && next.target_reps_high < next.target_reps_low) next.target_reps_high = next.target_reps_low
        if (patch.target_reps_high !== undefined && next.target_reps_low > next.target_reps_high) next.target_reps_low = next.target_reps_high
        return next
      }),
    )

  const move = (index: number, dir: -1 | 1) =>
    setItems((list) => {
      const j = index + dir
      if (j < 0 || j >= list.length) return list
      const copy = [...list]
      ;[copy[index], copy[j]] = [copy[j], copy[index]]
      return copy
    })

  const add = (ex: Exercise) => {
    const item: Item = { id: newId(), exercise_id: ex.id, target_sets: 3, target_reps_low: 8, target_reps_high: 12, rest_seconds: DEFAULT_REST_SEC }
    setPicked((m) => new Map(m).set(ex.id, ex))
    setItems((list) => [...list, item])
    setOpen(item.id)
  }

  const submit = () => {
    const parsed = templateInput.safeParse({ name, weekdays, exercises: items })
    if (!parsed.success) {
      setValidation(parsed.error.issues[0]?.message ?? 'invalid')
      return
    }
    setValidation(null)
    save.mutate({ id: template?.id ?? null, input: parsed.data }, { onSuccess: () => navigate(backTo) })
  }

  return (
    <PageShell
      title={template ? t('editor.editTitle') : t('editor.newTitle')}
      leading={
        <div className="flex items-center gap-1">
          <Link to={backTo} aria-label={t('common.back')} className="-ml-2 flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink">
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <span className="truncate text-lg font-bold tracking-tight">{template ? t('editor.editTitle') : t('editor.newTitle')}</span>
        </div>
      }
    >
      <div className="mx-auto max-w-2xl space-y-8 pb-28 lg:pb-8">
        <div>
          <label htmlFor="plan-name" className="eyebrow mb-2 block">
            {t('editor.name')}
          </label>
          <input
            id="plan-name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('editor.namePlaceholder')}
            className="hairline h-14 w-full rounded-[var(--radius-input)] bg-surface px-4 text-[20px] font-semibold text-ink placeholder:font-normal placeholder:text-ink-faint focus:border-volt/60 focus:outline-none"
          />
        </div>

        <div>
          <p className="eyebrow mb-2">{t('editor.days')}</p>
          <WeekdayPicker value={weekdays} onChange={setWeekdays} />
          <p className="mt-2 text-[13px] text-ink-faint">{weekdays.length ? t('editor.daysHint') : t('editor.daysNone')}</p>
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <p className="eyebrow">{t('editor.exercises')}</p>
            {items.length > 0 && <p className="tabular text-[13px] text-ink-muted">{t('plans.meta', { count: items.length, min: minutes })}</p>}
          </div>

          {items.length === 0 ? (
            <p className="hairline rounded-[var(--radius-card)] px-4 py-6 text-center text-sm text-ink-faint">{t('editor.noExercises')}</p>
          ) : (
            <ol className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
              {items.map((it, index) => {
                const ex = byId.get(it.exercise_id)
                const isOpen = open === it.id
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : it.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      <span className="tabular w-5 text-[13px] font-semibold text-ink-faint">{String(index + 1).padStart(2, '0')}</span>
                      <ExerciseThumb exercise={ex} size={44} />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-[15px] font-semibold leading-snug">{ex ? exerciseName(ex, i18n.resolvedLanguage) : '…'}</span>
                        <span className="tabular block text-[13px] text-ink-muted">
                          {t('editor.summary', {
                            sets: it.target_sets,
                            reps: it.target_reps_low === it.target_reps_high ? it.target_reps_low : `${it.target_reps_low}–${it.target_reps_high}`,
                            rest: formatClock(it.rest_seconds),
                          })}
                        </span>
                      </span>
                      <ChevronDown className={cn('size-4 shrink-0 text-ink-faint transition-transform motion-reduce:transition-none', isOpen && 'rotate-180')} aria-hidden />
                    </button>

                    {isOpen && (
                      <div className="space-y-5 border-t border-line bg-bg/40 px-4 pb-3 pt-4">
                        <div className="grid grid-cols-2 gap-x-3 gap-y-5">
                          <Stepper
                            size="sm"
                            label={t('editor.sets')}
                            value={it.target_sets}
                            onChange={(v) => update(it.id, { target_sets: v ?? 1 })}
                            step={1}
                            min={1}
                            max={50}
                            decLabel={t('editor.dec', { what: t('editor.sets') })}
                            incLabel={t('editor.inc', { what: t('editor.sets') })}
                          />
                          <Stepper
                            size="sm"
                            label={t('editor.rest')}
                            value={it.rest_seconds}
                            onChange={(v) => update(it.id, { rest_seconds: v ?? 0 })}
                            step={15}
                            min={0}
                            max={600}
                            format={formatClock}
                            decLabel={t('editor.dec', { what: t('editor.rest') })}
                            incLabel={t('editor.inc', { what: t('editor.rest') })}
                          />
                          <Stepper
                            size="sm"
                            label={t('editor.repsLow')}
                            value={it.target_reps_low}
                            onChange={(v) => update(it.id, { target_reps_low: v ?? 1 })}
                            step={1}
                            min={1}
                            max={500}
                            decLabel={t('editor.dec', { what: t('editor.repsLow') })}
                            incLabel={t('editor.inc', { what: t('editor.repsLow') })}
                          />
                          <Stepper
                            size="sm"
                            label={t('editor.repsHigh')}
                            value={it.target_reps_high}
                            onChange={(v) => update(it.id, { target_reps_high: v ?? 1 })}
                            step={1}
                            min={1}
                            max={500}
                            decLabel={t('editor.dec', { what: t('editor.repsHigh') })}
                            incLabel={t('editor.inc', { what: t('editor.repsHigh') })}
                          />
                        </div>
                        <div className="flex items-center gap-1 border-t border-line pt-2">
                          <Button variant="ghost" size="icon" aria-label={t('editor.moveUp')} disabled={index === 0} onClick={() => move(index, -1)}>
                            <ArrowUp className="size-5" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('editor.moveDown')}
                            disabled={index === items.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDown className="size-5" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            className="ml-auto text-danger hover:text-danger"
                            onClick={() => {
                              setItems((list) => list.filter((x) => x.id !== it.id))
                              setOpen(null)
                            }}
                          >
                            <Trash2 className="size-4" aria-hidden />
                            {t('editor.remove')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          )}

          <Button variant="secondary" size="lg" className="mt-3 w-full" onClick={() => setPicker(true)}>
            <Plus className="size-5 text-volt" aria-hidden />
            {t('editor.addExercise')}
          </Button>
        </div>

        {template && (
          <div className="border-t border-line pt-6">
            <Button variant="ghost" className="text-danger hover:text-danger" onClick={() => setConfirmArchive(true)}>
              {t('editor.archive')}
            </Button>
            <p className="mt-1 px-4 text-[13px] text-ink-faint">{t('editor.archiveHint')}</p>
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-[calc(var(--nav-h)+var(--sab))] z-30 border-t border-line bg-bg/90 px-4 py-3 backdrop-blur lg:sticky lg:inset-x-auto lg:bottom-0 lg:-mx-4">
        <div className="mx-auto max-w-2xl">
          {(validation || save.error) && (
            <div className="mb-2">
              {validation ? (
                <p role="alert" className="text-sm text-danger">
                  {t(`editor.errors.${validation}`, { defaultValue: t('editor.errors.invalid') })}
                </p>
              ) : (
                <ErrorNote error={save.error} />
              )}
            </div>
          )}
          <Button size="lg" className="w-full" disabled={save.isPending || name.trim() === ''} onClick={submit}>
            {save.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
            {t('editor.save')}
          </Button>
        </div>
      </div>

      <ExercisePickerSheet
        open={picker}
        onClose={() => setPicker(false)}
        onPick={add}
        selectedIds={ids}
        title={t('editor.addExercise')}
      />

      <ConfirmSheet
        open={confirmArchive}
        title={t('editor.archiveConfirmTitle')}
        body={t('editor.archiveConfirmBody')}
        confirmLabel={t('editor.archive')}
        tone="danger"
        pending={archive.isPending}
        error={archive.error}
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() => template && archive.mutate(template.id, { onSuccess: () => navigate(backTo) })}
      />
    </PageShell>
  )
}
