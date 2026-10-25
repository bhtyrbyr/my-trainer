import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { addDays, format, parseISO } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { CalendarDays, ChevronLeft, ChevronRight, Droplet, Loader2, Plus } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import {
  MEASURE_FIELDS,
  bmi,
  latestMeasurements,
  latestWeightOnOrBefore,
  navyBodyFat,
  useBodyMetrics,
  usePrivateWeights,
} from '@/features/body'
import { MEAL_SLOTS, useMeals, type MealSlot } from '@/features/nutrition'
import { useUserSettings } from '@/features/settings/hooks'
import { DEFAULT_WATER_GOAL, splitDuration, useAddWater, useSleepWeek, useWater, waterTotal } from '@/features/sleepwater'
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
  const one = useMemo(
    () => new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    [lang],
  )
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
  const profile = usePrivateWeights()
  const { settings } = useUserSettings()
  const water = useWater(day)
  const sleep = useSleepWeek(day)
  const addWater = useAddWater()
  const waterMl = waterTotal(water.data ?? [])
  const waterGoal = settings?.daily_water_ml ?? DEFAULT_WATER_GOAL
  const night = (sleep.data ?? []).find((n) => n.sleep_on === day) ?? null
  const goalKcal = preview ? 2200 : (settings?.daily_kcal ?? null)

  const setDay = (d: string) => setParams(d === today ? {} : { day: d }, { replace: true })
  const shift = (n: number) => setDay(toLocalDateISO(addDays(parseISO(day), n)))
  const yesterday = toLocalDateISO(addDays(new Date(), -1))
  const label =
    day === today
      ? t('track:day.today')
      : day === yesterday
        ? t('track:day.yesterday')
        : format(parseISO(day), 'd MMMM, EEEE', { locale })

  const entries = meals.data ?? []
  const eaten = entries.reduce((s, e) => s + e.kcal, 0)
  const bodyRow = (body.data ?? []).find((r) => r.measured_on === day) ?? null
  const measureCount = bodyRow ? MEASURE_FIELDS.filter((k) => bodyRow[k] != null).length : 0
  const lastWeigh = latestWeightOnOrBefore(body.data ?? [], day)
  const bodyIndex = bmi(lastWeigh?.kg, profile.data?.height)
  const upToDay = latestMeasurements((body.data ?? []).filter((r) => r.measured_on <= day))
  const measure = (k: string) => upToDay.find((m) => m.field === k)?.value ?? null
  const fat = navyBodyFat({ sex: profile.data?.sex, heightCm: profile.data?.height, neckCm: measure('neck_cm'), waistCm: measure('waist_cm'), hipCm: measure('hip_cm') })
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
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('track:day.pick')}
          title={t('track:day.pick')}
          onClick={() => setPicking(true)}
        >
          <CalendarDays className="size-5" aria-hidden />
        </Button>
      }
    >
      <div className="mx-auto max-w-2xl space-y-6 pb-6">
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label={t('track:day.prev')}
            onClick={() => shift(-1)}
            className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="display h-11 rounded-full px-3 text-[22px] capitalize hover:bg-raised"
            aria-live="polite"
          >
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

        <ErrorNote error={meals.error ?? sessions.error ?? body.error ?? burned.error ?? profile.error ?? water.error ?? sleep.error} />

        {/* One nutrition card: eaten | burned (never netted) on top, the day's meals by slot below. */}
        <section
          aria-label={t('track:nutrition.name')}
          className="hairline overflow-hidden rounded-[var(--radius-card)] bg-surface"
        >
          <Link
            to={`${base}/nutrition${dayQuery}`}
            aria-label={t('track:energy.open')}
            className="grid grid-cols-2 hover:bg-raised/40"
          >
            <Figure
              eyebrow={t('nutrition:ledger.eaten')}
              value={nf.format(eaten)}
              sub={
                goalKcal
                  ? `${t('nutrition:ledger.goal', { kcal: nf.format(goalKcal) })} · ${
                      eaten > goalKcal
                        ? t('nutrition:ledger.over', { kcal: nf.format(eaten - goalKcal) })
                        : t('nutrition:ledger.left', { kcal: nf.format(goalKcal - eaten) })
                    }`
                  : t('track:meals.items', { count: entries.length })
              }
              progress={goalKcal ? { value: eaten, goal: goalKcal } : undefined}
            />
            <Figure
              eyebrow={t('nutrition:ledger.burned')}
              value={nf.format(burned.data?.kcal ?? 0)}
              approx={trained}
              muted
              border
              sub={trained ? t('nutrition:ledger.burnedShort') : t('track:workouts.none')}
            />
          </Link>
          <div className="border-t border-line">
            {slots.length > 0 ? (
              <Link
                to={`${base}/nutrition${dayQuery}`}
                aria-label={t('track:meals.open')}
                className="block hover:bg-raised/40"
              >
                <ul className="divide-y divide-line">
                  {slots.map((s) => (
                    <li key={s.slot} className="flex h-12 items-center gap-3 px-4">
                      <span className="flex-1 text-[14px] font-medium">{t(`nutrition:slots.${s.slot}`)}</span>
                      <span className="text-[12px] text-ink-faint">
                        {t('track:meals.items', { count: s.count })}
                      </span>
                      <span className="tabular w-20 text-right text-[14px] font-semibold">
                        {nf.format(s.kcal)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Link>
            ) : (
              <Empty
                text={t('track:meals.none')}
                action={t('track:meals.add')}
                to={`${base}/nutrition${dayQuery}`}
              />
            )}
          </div>
        </section>

        {/* Water and sleep: the day's water with a one-tap +250 ml, and the night that ended this morning. */}
        <section aria-label={t('sleepwater:title')} className="hairline overflow-hidden rounded-[var(--radius-card)] bg-surface">
          <div className="flex items-center gap-3 p-4">
            <Link to={`${base}/sleep-water${dayQuery}`} aria-label={t('track:water.open')} className="min-w-0 flex-1">
              <p className="eyebrow">{t('track:water.name')}</p>
              <p className="mt-2 flex items-baseline gap-1">
                <span className="display tabular text-[30px] leading-none">{nf.format(waterMl)}</span>
                <span className="tabular text-[12px] font-medium text-ink-faint">/ {nf.format(waterGoal)} ml</span>
              </p>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
                <div className="h-full rounded-full bg-volt" style={{ width: `${Math.min(100, (waterMl / waterGoal) * 100)}%` }} />
              </div>
            </Link>
            <button
              type="button"
              aria-label={t('track:water.addLabel')}
              disabled={addWater.isPending}
              onClick={() => addWater.mutate({ day, ml: 250 })}
              className="hairline flex h-14 shrink-0 items-center gap-1.5 rounded-[var(--radius-button)] bg-bg px-4 text-[15px] font-semibold transition-transform active:scale-[0.97] disabled:opacity-60"
            >
              {addWater.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Droplet className="size-4 text-volt" aria-hidden />}
              {t('track:water.add')}
            </button>
          </div>
          <ErrorNote error={addWater.error} className="mx-4 mb-3" />
          <div className="border-t border-line">
            {night ? (
              <Link to={`${base}/sleep-water${dayQuery}`} className="flex min-h-12 items-center gap-3 px-4 py-2.5 hover:bg-raised/40">
                <span className="eyebrow w-14 shrink-0">{t('track:sleep.name')}</span>
                <span className="tabular flex-1 text-[15px] font-semibold">{t('sleepwater:sleep.duration', splitDuration(night.duration_min))}</span>
                {night.quality != null && <span className="text-[12px] text-ink-faint">{t('sleepwater:sleep.qualityN', { n: night.quality })}</span>}
                <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
              </Link>
            ) : (
              <Empty text={t('track:sleep.none')} action={t('track:sleep.log')} to={`${base}/sleep-water${dayQuery}`} />
            )}
          </div>
        </section>

        {/* Body: latest weigh-in up to this day and the body mass index; opens the body page. */}
        {lastWeigh ? (
          <section
            aria-label={t('track:body.name')}
            className="hairline overflow-hidden rounded-[var(--radius-card)] bg-surface"
          >
            <Link
              to={`${base}/body`}
              aria-label={t('track:body.open')}
              className="grid grid-cols-2 hover:bg-raised/40"
            >
              <Figure
                eyebrow={t('body:lastWeigh')}
                value={one.format(lastWeigh.kg)}
                unit="kg"
                sub={lastWeigh.day === day ? label : format(parseISO(lastWeigh.day), 'd MMM', { locale })}
              />
              <Figure
                eyebrow={t('body:bmi.label')}
                value={bodyIndex ? one.format(bodyIndex.value) : '–'}
                unit=""
                muted={!bodyIndex}
                border
                sub={bodyIndex ? t(`body:bmi.category.${bodyIndex.category}`) : t('body:bmi.needHeight')}
              />
            </Link>
            {fat.ok && (
              <Link to={`${base}/body`} className="block border-t border-line px-4 py-3 text-[13px] text-ink-muted hover:bg-raised/40">
                {t('track:body.fat', { value: one.format(fat.value), category: t(`body:fat.category.${fat.category}`) })}
              </Link>
            )}
            {(measureCount > 0 || bodyRow?.weight_kg == null) && (
              <div className="border-t border-line">
                {measureCount > 0 ? (
                  <p className="px-4 py-3 text-[13px] text-ink-muted">
                    {t('track:body.measures', { count: measureCount })}
                  </p>
                ) : (
                  <Empty
                    text={t('track:body.none')}
                    action={t('track:body.log')}
                    to={`${base}/body?log=${day}`}
                  />
                )}
              </div>
            )}
          </section>
        ) : (
          <section
            aria-label={t('track:body.name')}
            className="hairline overflow-hidden rounded-[var(--radius-card)] bg-surface"
          >
            <Empty text={t('track:body.none')} action={t('track:body.log')} to={`${base}/body?log=${day}`} />
          </section>
        )}

        <section
          aria-label={t('track:workouts.name')}
          className="hairline overflow-hidden rounded-[var(--radius-card)] bg-surface"
        >
          <Link
            to={workoutsBase}
            aria-label={t('track:workouts.start')}
            className="flex h-11 items-center justify-between px-4 hover:bg-raised/40"
          >
            <span className="eyebrow">{t('track:workouts.name')}</span>
            <ChevronRight className="size-4 text-ink-faint" aria-hidden />
          </Link>
          <div className="border-t border-line">
            {(sessions.data ?? []).length > 0 ? (
              <ul className="divide-y divide-line">
                {(sessions.data ?? []).map((s) => (
                  <li key={s.id}>
                    <Link
                      to={`/workouts/history/${s.id}`}
                      className="flex min-h-12 items-center gap-3 px-4 py-2.5 hover:bg-raised/50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium">{sessionTitle(s, t)}</span>
                        <span className="tabular block text-[12px] text-ink-faint">
                          {format(new Date(s.started_at), 'HH:mm')} ·{' '}
                          {t('workouts:units.minN', {
                            n: Math.max(1, Math.round((s.duration_sec ?? 0) / 60)),
                          })}
                        </span>
                      </span>
                      {s.kcal_estimate != null && (
                        <span className="tabular shrink-0 text-[13px] text-ink-muted">
                          ≈ {nf.format(s.kcal_estimate)} kcal
                        </span>
                      )}
                      <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty text={t('track:workouts.none')} action={t('track:workouts.start')} to={workoutsBase} />
            )}
          </div>
        </section>

        <p className="px-1 text-[12px] leading-snug text-ink-faint">
          <span className="font-semibold text-ink-muted">{t('track:soon.title')}:</span>{' '}
          {t('track:soon.list')}
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

function Figure({
  eyebrow,
  value,
  sub,
  approx,
  muted,
  border,
  progress,
  unit = 'kcal',
}: {
  eyebrow: string
  value: string
  unit?: string
  sub: string
  approx?: boolean
  muted?: boolean
  border?: boolean
  progress?: { value: number; goal: number }
}) {
  const pct = progress ? Math.min(100, (progress.value / progress.goal) * 100) : 0
  const over = progress ? progress.value > progress.goal : false
  return (
    <div className={border ? 'min-w-0 border-l border-line p-4' : 'min-w-0 p-4'}>
      <p className="eyebrow">{eyebrow}</p>
      <p className="mt-2.5 flex items-baseline gap-1">
        {approx && <span className="text-[16px] text-ink-faint">≈</span>}
        <span
          className={
            muted
              ? 'display tabular text-[30px] leading-none text-ink-muted'
              : 'display tabular text-[30px] leading-none'
          }
        >
          {value}
        </span>
        {unit && <span className="text-[12px] font-medium text-ink-faint">{unit}</span>}
      </p>
      {progress && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.goal}
          aria-valuenow={progress.value}
          aria-label={sub}
          className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-raised"
        >
          <div
            className={over ? 'h-full rounded-full bg-ink-muted' : 'h-full rounded-full bg-volt'}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <p className="tabular mt-2 truncate text-[12px] text-ink-faint">{sub}</p>
    </div>
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
