import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { addDays, format, parseISO } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { MEASURE_FIELDS, useBodyMetrics } from '@/features/body'
import { MEAL_SLOTS, useMeals, type MealSlot } from '@/features/nutrition'
import { sessionTitle, useBurnedOn, useSessionsOn } from '@/features/workouts'
import { toLocalDateISO } from '@/lib/dates'
import { DayPickerSheet } from '../components/DayPickerSheet'

/**
 * Track. Point of view: one day's logbook. Pick any day (arrows or the calendar) and see everything
 * logged on it: eaten vs burned, the weigh-in, workouts and meals; each block opens its module.
 * Habits, to-dos, sleep/water and photos join this page as they ship.
 */
export function TrackPage({ preview = false }: { preview?: boolean }) {
  const { t, i18n } = useTranslation(['track', 'workouts', 'nutrition'])
  const lang = i18n.resolvedLanguage === 'en' ? 'en' : 'tr'
  const locale = lang === 'en' ? enUS : tr
  const nf = useMemo(() => new Intl.NumberFormat(lang), [lang])
  const one = useMemo(() => new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), [lang])
  const [params, setParams] = useSearchParams()
  const [picking, setPicking] = useState(false)
  const today = toLocalDateISO()
  const dayParam = params.get('day')
  const day = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) && dayParam <= today ? dayParam : today
  const base = preview ? '/__dev/track' : '/track'
  const workoutsBase = preview ? '/__dev/workouts' : '/workouts'

  const meals = useMeals(day)
  const burned = useBurnedOn(day, preview ? { kcal: 412, sessions: 1 } : undefined)
  const sessions = useSessionsOn(day)
  const body = useBodyMetrics()

  const setDay = (d: string) => setParams(d === today ? {} : { day: d }, { replace: true })
  const shift = (n: number) => setDay(toLocalDateISO(addDays(parseISO(day), n)))
  const yesterday = toLocalDateISO(addDays(new Date(), -1))
  const label = day === today ? t('track:day.today') : day === yesterday ? t('track:day.yesterday') : format(parseISO(day), 'd MMMM, EEEE', { locale })

  const entries = meals.data ?? []
  const eaten = entries.reduce((s, e) => s + e.kcal, 0)
  const bodyRow = (body.data ?? []).find((r) => r.measured_on === day) ?? null
  const measureCount = bodyRow ? MEASURE_FIELDS.filter((k) => bodyRow[k] != null).length : 0
  const slots = MEAL_SLOTS.map((s) => {
    const rows = entries.filter((e) => e.meal_slot === s)
    return { slot: s as MealSlot, count: rows.length, kcal: rows.reduce((a, e) => a + e.kcal, 0) }
  }).filter((x) => x.count > 0)
  const dayQuery = day === today ? '' : `?day=${day}`
  const trained = (burned.data?.sessions ?? 0) > 0

  return (
    <PageShell
      title={t('track:title')}
      subtitle={t('track:subtitle')}
      actions={
        <Button variant="ghost" size="icon" aria-label={t('track:day.pick')} title={t('track:day.pick')} onClick={() => setPicking(true)}>
          <CalendarDays className="size-5" aria-hidden />
        </Button>
      }
    >
      <div className="mx-auto max-w-2xl space-y-6 pb-6">
        <div className="flex items-center justify-between">
          <button type="button" aria-label={t('track:day.prev')} onClick={() => shift(-1)} className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink">
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button type="button" onClick={() => setPicking(true)} className="display h-11 rounded-full px-3 text-[22px] capitalize hover:bg-raised" aria-live="polite">
            {label}
          </button>
          <button
            type="button"
            aria-label={t('track:day.next')}
            disabled={day >= today}
            onClick={() => shift(1)}
            className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink disabled:opacity-30"
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>

        <ErrorNote error={meals.error ?? sessions.error ?? body.error ?? burned.error} />

        {/* eaten | burned, never netted */}
        <Link to={`${base}/nutrition${dayQuery}`} aria-label={t('track:energy.open')} className="hairline grid grid-cols-2 overflow-hidden rounded-[var(--radius-card)] bg-surface hover:bg-raised/40">
          <Figure eyebrow={t('nutrition:ledger.eaten')} value={nf.format(eaten)} sub={entries.length ? t('track:meals.items', { count: entries.length }) : t('track:meals.add')} />
          <Figure
            eyebrow={t('nutrition:ledger.burned')}
            value={nf.format(burned.data?.kcal ?? 0)}
            approx={trained}
            muted
            border
            sub={trained ? t('nutrition:ledger.burnedShort') : t('track:workouts.none')}
          />
        </Link>

        <Block title={t('track:body.name')} to={`${base}/body`} openLabel={t('track:body.open')}>
          {bodyRow?.weight_kg != null || measureCount > 0 ? (
            <div className="flex items-baseline justify-between gap-3 px-4 py-3.5">
              <span className="tabular text-[20px] font-semibold">
                {bodyRow?.weight_kg != null ? (
                  <>
                    {one.format(Number(bodyRow.weight_kg))} <span className="text-[13px] font-medium text-ink-faint">kg</span>
                  </>
                ) : (
                  '–'
                )}
              </span>
              {measureCount > 0 && <span className="text-[13px] text-ink-muted">{t('track:body.measures', { count: measureCount })}</span>}
            </div>
          ) : (
            <Empty text={t('track:body.none')} action={t('track:body.log')} to={`${base}/body?log=${day}`} />
          )}
        </Block>

        <Block title={t('track:workouts.name')} to={workoutsBase} openLabel={t('track:workouts.start')}>
          {(sessions.data ?? []).length > 0 ? (
            <ul className="divide-y divide-line">
              {(sessions.data ?? []).map((s) => (
                <li key={s.id}>
                  <Link to={`/workouts/history/${s.id}`} className="flex min-h-12 items-center gap-3 px-4 py-2.5 hover:bg-raised/50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{sessionTitle(s, t)}</span>
                      <span className="tabular block text-[12px] text-ink-faint">
                        {format(new Date(s.started_at), 'HH:mm')} · {t('workouts:units.minN', { n: Math.max(1, Math.round((s.duration_sec ?? 0) / 60)) })}
                      </span>
                    </span>
                    {s.kcal_estimate != null && <span className="tabular shrink-0 text-[13px] text-ink-muted">≈ {nf.format(s.kcal_estimate)} kcal</span>}
                    <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text={t('track:workouts.none')} action={t('track:workouts.start')} to={workoutsBase} />
          )}
        </Block>

        <Block title={t('track:meals.name')} to={`${base}/nutrition${dayQuery}`} openLabel={t('track:meals.open')}>
          {slots.length > 0 ? (
            <ul className="divide-y divide-line">
              {slots.map((s) => (
                <li key={s.slot} className="flex h-12 items-center gap-3 px-4">
                  <span className="flex-1 text-[14px] font-medium">{t(`nutrition:slots.${s.slot}`)}</span>
                  <span className="text-[12px] text-ink-faint">{t('track:meals.items', { count: s.count })}</span>
                  <span className="tabular w-20 text-right text-[14px] font-semibold">{nf.format(s.kcal)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text={t('track:meals.none')} action={t('track:meals.add')} to={`${base}/nutrition${dayQuery}`} />
          )}
        </Block>

        <p className="px-1 text-[12px] leading-snug text-ink-faint">
          <span className="font-semibold text-ink-muted">{t('track:soon.title')}:</span> {t('track:soon.list')}
        </p>
      </div>

      <DayPickerSheet
        open={picking}
        value={day}
        onPick={(d) => {
          setDay(d)
          setPicking(false)
        }}
        onClose={() => setPicking(false)}
      />
    </PageShell>
  )
}

function Figure({ eyebrow, value, sub, approx, muted, border }: { eyebrow: string; value: string; sub: string; approx?: boolean; muted?: boolean; border?: boolean }) {
  return (
    <div className={border ? 'border-l border-line p-4' : 'p-4'}>
      <p className="eyebrow">{eyebrow}</p>
      <p className="mt-2.5 flex items-baseline gap-1">
        {approx && <span className="text-[16px] text-ink-faint">≈</span>}
        <span className={muted ? 'display tabular text-[30px] leading-none text-ink-muted' : 'display tabular text-[30px] leading-none'}>{value}</span>
        <span className="text-[12px] font-medium text-ink-faint">kcal</span>
      </p>
      <p className="mt-2 truncate text-[12px] text-ink-faint">{sub}</p>
    </div>
  )
}

function Block({ title, to, openLabel, children }: { title: string; to: string; openLabel: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="display text-[20px]">{title}</h2>
        <Link to={to} aria-label={openLabel} className="-mr-2 flex size-11 items-center justify-center rounded-full text-ink-faint hover:bg-raised hover:text-ink">
          <ChevronRight className="size-5" aria-hidden />
        </Link>
      </div>
      <div className="hairline overflow-hidden rounded-[var(--radius-card)] bg-surface">{children}</div>
    </section>
  )
}

function Empty({ text, action, to }: { text: string; action: string; to: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-[13px] text-ink-muted">{text}</span>
      <Link to={to} className="flex h-11 shrink-0 items-center gap-1 text-[13px] font-semibold text-volt">
        <Plus className="size-4" aria-hidden />
        {action}
      </Link>
    </div>
  )
}
