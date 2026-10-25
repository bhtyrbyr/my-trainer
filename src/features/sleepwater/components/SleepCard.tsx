import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { format, parseISO } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { Loader2, Moon, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { toLocalDateISO } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useDeleteSleep, useSaveSleep, useSleepWeek } from '../hooks'
import { averageMinutes, hhmm, minutesBetween, nightWindow, sleepWeek, splitDuration } from '../logic'
import type { SleepEntry } from '../types'

const TARGET_MIN = 7 * 60

/**
 * Sleep for the night that ends on `day`: a logged night reads like a ticket (duration, times,
 * quality) with edit; otherwise two time fields, a live duration and a 1-5 quality scale.
 * Below, the last 7 nights as bars against a 7-hour rule.
 */
export function SleepCard({ day }: { day: string }) {
  const { t, i18n } = useTranslation('sleepwater')
  const locale = i18n.resolvedLanguage === 'en' ? enUS : tr
  const week = useSleepWeek(day)
  const rows = week.data ?? []
  const night = rows.find((r) => r.sleep_on === day) ?? null
  const [editing, setEditing] = useState(false)
  const today = toLocalDateISO()
  const dur = (min: number) => t('sleep.duration', splitDuration(min))

  return (
    <section aria-labelledby="sleep-title" className="hairline overflow-hidden rounded-[var(--radius-card)] bg-surface">
      <div className="p-5">
        <h2 id="sleep-title" className="eyebrow">
          {t('sleep.title')} · {day === today ? t('sleep.night') : t('sleep.nightOf', { date: format(parseISO(day), 'd MMMM', { locale }) })}
        </h2>
        <ErrorNote error={week.error} className="mt-3" />
        {night && !editing ? (
          <NightSummary night={night} dur={dur} onEdit={() => setEditing(true)} day={day} />
        ) : (
          <NightForm key={`${day}-${night?.id ?? 'new'}`} day={day} night={night} last={rows[rows.length - 1] ?? null} onDone={() => setEditing(false)} dur={dur} />
        )}
      </div>
      <Week rows={rows} day={day} dur={dur} />
    </section>
  )
}

function NightSummary({ night, dur, onEdit, day }: { night: SleepEntry; dur: (m: number) => string; onEdit: () => void; day: string }) {
  const { t } = useTranslation('sleepwater')
  const del = useDeleteSleep()
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="mt-3">
      <p className="display tabular text-[44px] leading-none tracking-[-0.03em]">{dur(night.duration_min)}</p>
      <p className="tabular mt-2 text-[14px] text-ink-muted">
        {hhmm(night.bed_at)} → {hhmm(night.wake_at)}
        {night.quality != null && (
          <>
            <span className="mx-2 text-ink-faint">·</span>
            {t('sleep.qualityN', { n: night.quality })} ({t(`sleep.qualityLabels.${night.quality}`)})
          </>
        )}
      </p>
      <ErrorNote error={del.error} className="mt-3" />
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" size="sm" className="h-11" onClick={onEdit}>
          <Pencil className="size-4" aria-hidden />
          {t('sleep.edit')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn('h-11', confirm && 'text-danger')}
          disabled={del.isPending}
          onClick={() => (confirm ? del.mutate({ id: night.id, day }) : setConfirm(true))}
        >
          <Trash2 className="size-4" aria-hidden />
          {confirm ? t('sleep.confirmDelete') : t('sleep.delete')}
        </Button>
      </div>
    </div>
  )
}

function NightForm({ day, night, last, onDone, dur }: { day: string; night: SleepEntry | null; last: SleepEntry | null; onDone: () => void; dur: (m: number) => string }) {
  const { t } = useTranslation('sleepwater')
  const save = useSaveSleep()
  const [bed, setBed] = useState(night ? hhmm(night.bed_at) : last ? hhmm(last.bed_at) : '23:30')
  const [wake, setWake] = useState(night ? hhmm(night.wake_at) : last ? hhmm(last.wake_at) : '07:30')
  const [quality, setQuality] = useState<number | null>(night?.quality ?? null)
  const { bedAt, wakeAt } = nightWindow(day, bed, wake)
  const minutes = minutesBetween(bedAt, wakeAt)
  const valid = Boolean(bed && wake) && minutes > 0 && minutes <= 1200

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <TimeField label={t('sleep.bed')} value={bed} onChange={setBed} />
        <TimeField label={t('sleep.wake')} value={wake} onChange={setWake} />
      </div>
      <p className="flex items-center gap-2 text-[15px]">
        <Moon className="size-4 text-ink-faint" aria-hidden />
        <span className="tabular font-semibold">{valid ? dur(minutes) : '–'}</span>
        {valid && minutes < 120 && <span className="text-[12px] text-ink-faint">{t('sleep.tooShort')}</span>}
      </p>
      <fieldset>
        <legend className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">{t('sleep.quality')}</legend>
        <div className="grid grid-cols-5 gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={quality === n}
              aria-label={t(`sleep.qualityLabels.${n}`)}
              title={t(`sleep.qualityLabels.${n}`)}
              onClick={() => setQuality(quality === n ? null : n)}
              className={cn(
                'tabular h-11 rounded-[var(--radius-input)] text-[15px] font-semibold transition-colors',
                quality === n ? 'bg-ink text-bg' : 'hairline text-ink-muted hover:text-ink',
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="mt-1.5 h-4 text-[12px] text-ink-faint">{quality ? t(`sleep.qualityLabels.${quality}`) : ''}</p>
      </fieldset>
      <ErrorNote error={save.error} />
      <Button size="lg" className="w-full" disabled={!valid || save.isPending} onClick={() => save.mutate({ day, bedAt, wakeAt, quality }, { onSuccess: onDone })}>
        {save.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
        {night ? t('sleep.update') : t('sleep.save')}
      </Button>
      <p className="text-center text-[11px] text-ink-faint">{t('sleep.points')}</p>
    </div>
  )
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="tabular hairline h-14 w-full rounded-[var(--radius-input)] bg-bg px-3 text-[22px] font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-volt"
      />
    </label>
  )
}

function Week({ rows, day, dur }: { rows: SleepEntry[]; day: string; dur: (m: number) => string }) {
  const { t, i18n } = useTranslation('sleepwater')
  const locale = i18n.resolvedLanguage === 'en' ? enUS : tr
  const week = sleepWeek(rows, day)
  const avg = averageMinutes(week)
  const max = Math.max(TARGET_MIN + 60, ...week.map((w) => w.minutes ?? 0))
  return (
    <div className="border-t border-line px-5 pb-4 pt-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="eyebrow">{t('sleep.week')}</p>
        {avg != null && <p className="tabular text-[12px] text-ink-muted">{t('sleep.average', splitDuration(avg))}</p>}
      </div>
      <div className="relative mt-3 h-24" role="img" aria-label={week.map((w) => t('sleep.barLabel', { day: format(parseISO(w.day), 'EEEE', { locale }), value: w.minutes != null ? dur(w.minutes) : t('sleep.noData') })).join(', ')}>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-ink-faint/60" style={{ bottom: `${(TARGET_MIN / max) * 100}%` }}>
          <span className="absolute -top-2 right-0 rounded-sm bg-surface px-1 text-[10px] leading-4 text-ink-muted">{t('sleep.target')}</span>
        </div>
        <div className="absolute inset-0 grid grid-cols-7 items-end gap-2">
          {week.map((w) => (
            <div key={w.day} className="flex h-full items-end justify-center">
              <div
                className={cn('w-full max-w-7 rounded-t-[4px]', w.minutes == null ? 'h-1 bg-raised' : w.minutes >= TARGET_MIN ? 'bg-volt' : 'bg-ink-muted/60', w.day === day && 'ring-2 ring-ink/30')}
                style={w.minutes != null ? { height: `${Math.max(4, (w.minutes / max) * 100)}%` } : undefined}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-7 gap-2">
        {week.map((w) => (
          <span key={w.day} className={cn('text-center text-[10px] font-semibold uppercase', w.day === day ? 'text-ink' : 'text-ink-faint')}>
            {format(parseISO(w.day), 'EEEEEE', { locale })}
          </span>
        ))}
      </div>
    </div>
  )
}
