import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { LineChart as LineChartIcon, TrendingDown, TrendingUp } from 'lucide-react'
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { useUnits } from '@/features/settings/useUnits'
import { kgToDisplay } from '@/lib/units'
import { cn } from '@/lib/utils'
import { useExerciseProgress, useRecentSets } from '../hooks'
import {
  filterByPeriod,
  groupSessions,
  PROGRESS_PERIODS,
  summarize,
  type ProgressPeriod,
  type ProgressPoint,
  type SessionSets,
} from '../progress'

const HISTORY_LIMIT = 10

/** Weights in the user's unit (stored kg): real set weights keep their plate rounding, computed ones 1 decimal. */
function useFormat() {
  const { i18n } = useTranslation()
  const u = useUnits()
  const lang = i18n.resolvedLanguage ?? 'tr'
  return useMemo(() => {
    const locale = lang.startsWith('tr') ? tr : enUS
    const pct = new Intl.NumberFormat(lang, { maximumFractionDigits: 1, signDisplay: 'exceptZero' })
    const dash = (fn: (n: number) => string) => (n: number | null) => (n === null ? '–' : fn(n))
    return {
      unit: u.weightLabel,
      /** stored kg -> exact number in the user's unit (chart data) */
      toDisplay: (kg: number | null) => (kg === null ? null : kgToDisplay(kg, u.weight)),
      /** a logged set weight (best, history) */
      load: dash(u.load),
      /** a computed weight (average, e1RM) */
      est: dash(u.estimate),
      /** chart numbers already in the user's unit */
      loadValue: dash(u.loadValue),
      estValue: dash(u.estimateValue),
      pct: (n: number | null) => (n === null ? '–' : `${pct.format(n)}%`),
      date: (d: Date | number, pattern: string) => format(d, pattern, { locale }),
    }
  }, [lang, u])
}

/**
 * Point of view: the period average is the headline figure; the chart explains it and a ruled strip
 * underneath carries best / e1RM / change. One surface, no stacked cards. Volt marks only the
 * average-weight line and a positive change.
 */
export function ExerciseProgress({ exerciseId }: { exerciseId: string }) {
  const { t } = useTranslation('exercises')
  const progress = useExerciseProgress(exerciseId)
  const recent = useRecentSets(exerciseId, HISTORY_LIMIT)
  const [period, setPeriod] = useState<ProgressPeriod>('3m')
  const [now] = useState(() => new Date())

  const all = useMemo(() => progress.data ?? [], [progress.data])
  const rows = useMemo(() => filterByPeriod(all, period, now), [all, period, now])
  const summary = useMemo(() => summarize(rows), [rows])
  const sessions = useMemo(() => groupSessions(recent.data ?? []), [recent.data])

  return (
    <section aria-labelledby="progress-title">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="progress-title" className="display text-[22px]">
          {t('progress.title')}
        </h2>
        {all.length > 0 && <span className="tabular text-xs text-ink-faint">{t('progress.sessions', { count: summary.sessions })}</span>}
      </div>

      <ErrorNote error={progress.error} className="mb-3" />

      {progress.isLoading ? (
        <div aria-hidden className="hairline h-[360px] animate-pulse rounded-[var(--radius-card)] bg-surface" />
      ) : progress.error ? null : all.length === 0 ? (
        <EmptyProgress />
      ) : (
        <>
          <div role="tablist" aria-label={t('progress.periodLabel')} className="hairline mb-3 grid grid-cols-4 rounded-full bg-surface p-1">
            {PROGRESS_PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={period === p}
                onClick={() => setPeriod(p)}
                className={cn(
                  'h-11 rounded-full text-[13px] font-medium transition-colors',
                  period === p ? 'bg-raised text-ink' : 'text-ink-muted hover:text-ink',
                )}
              >
                {t(`progress.period.${p}`)}
              </button>
            ))}
          </div>

          <SummaryCard rows={rows} summary={summary} />
        </>
      )}

      {(sessions.length > 0 || recent.error) && <History sessions={sessions} error={recent.error} />}
    </section>
  )
}

function SummaryCard({ rows, summary }: { rows: ProgressPoint[]; summary: ReturnType<typeof summarize> }) {
  const { t } = useTranslation('exercises')
  const f = useFormat()
  const up = summary.change !== null && summary.change > 0
  const down = summary.change !== null && summary.change < 0
  return (
    <div className="hairline overflow-hidden rounded-[var(--radius-card)] bg-surface">
      <div className="px-4 pt-4">
        <p className="eyebrow">{t('progress.average')}</p>
        <p className="mt-2 flex items-baseline gap-1.5">
          <span className="display tabular text-[44px] leading-none">{f.est(summary.average)}</span>
          <span className="text-[17px] font-medium text-ink-muted">{f.unit}</span>
        </p>
      </div>

      {rows.length > 0 ? (
        <WeightChart rows={rows} average={summary.average} />
      ) : (
        <p className="px-4 py-12 text-center text-sm text-ink-muted">{t('progress.emptyPeriod')}</p>
      )}

      <dl className="grid grid-cols-3 divide-x divide-line border-t border-line">
        <Stat label={t('progress.best')} value={f.load(summary.best)} unit={summary.best !== null ? f.unit : undefined} />
        <Stat label={t('progress.e1rm')} value={f.est(summary.e1rm)} unit={summary.e1rm !== null ? f.unit : undefined} />
        <Stat
          label={t('progress.change')}
          title={t('progress.changeHint')}
          value={
            <span className={cn('inline-flex items-center gap-1', up && 'text-volt', down && 'text-ink-muted')}>
              {up && <TrendingUp className="size-4" aria-hidden />}
              {down && <TrendingDown className="size-4" aria-hidden />}
              {f.pct(summary.change)}
            </span>
          }
        />
      </dl>
    </div>
  )
}

function Stat({ label, value, unit, title }: { label: string; value: ReactNode; unit?: string; title?: string }) {
  return (
    <div className="min-w-0 px-3 py-3.5" title={title}>
      <dt className="truncate text-[11px] font-medium text-ink-faint">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-1 truncate">
        <span className="tabular text-[19px] font-semibold leading-tight">{value}</span>
        {unit && <span className="text-xs text-ink-faint">{unit}</span>}
      </dd>
    </div>
  )
}

type ChartPoint = { t: number; avg: number | null; best: number | null }

function WeightChart({ rows, average: averageKg }: { rows: ProgressPoint[]; average: number | null }) {
  const { t } = useTranslation('exercises')
  const f = useFormat()
  // the chart works in the user's unit so the axis ticks land on round lb / kg values
  const average = f.toDisplay(averageKg)
  const [animate] = useState(() => typeof window === 'undefined' || !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

  const data: ChartPoint[] = rows.map((r) => ({ t: new Date(r.started_at).getTime(), avg: f.toDisplay(r.avg_weight_kg), best: f.toDisplay(r.best_weight_kg) }))
  const values = data.flatMap((d) => [d.avg, d.best]).filter((v): v is number => v !== null)
  if (average !== null) values.push(average)
  const lo = values.length ? Math.min(...values) : 0
  const hi = values.length ? Math.max(...values) : 10
  const step = hi - lo > 40 ? 10 : 5
  const yDomain: [number, number] = [Math.max(0, Math.floor((lo - step / 2) / step) * step), Math.ceil((hi + step / 2) / step) * step]
  // round ticks on the step grid, at most ~4 of them
  const tickStep = step * Math.max(1, Math.ceil((yDomain[1] - yDomain[0]) / step / 4))
  yDomain[1] = yDomain[0] + Math.ceil((yDomain[1] - yDomain[0]) / tickStep) * tickStep
  const yTicks: number[] = []
  for (let v = yDomain[0]; v <= yDomain[1]; v += tickStep) yTicks.push(v)
  const first = data[0]?.t ?? 0
  const last = data[data.length - 1]?.t ?? 0
  const pad = first === last ? 3 * 86_400_000 : (last - first) * 0.04
  const xDomain: [number, number] = [first - pad, last + pad]

  return (
    <figure aria-label={t('progress.chartLabel')} className="mt-3">
      <div className="h-[184px] w-full pr-3">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={xDomain}
              tickFormatter={(v: number) => f.date(v, 'd MMM')}
              tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickCount={4}
              minTickGap={24}
            />
            <YAxis
              domain={yDomain}
              tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={40}
              ticks={yTicks}
            />
            <Tooltip
              cursor={{ stroke: 'var(--color-line-strong)', strokeWidth: 1 }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as ChartPoint | undefined) : undefined
                if (!p) return null
                return (
                  <div className="hairline rounded-[var(--radius-input)] bg-raised px-3 py-2 text-xs">
                    <p className="mb-1 font-semibold text-ink">{f.date(p.t, 'd MMM yyyy')}</p>
                    <p className="tabular text-ink-muted">
                      <span className="text-volt">●</span> {t('progress.legend.avg')}: {f.estValue(p.avg)} {f.unit}
                    </p>
                    <p className="tabular text-ink-muted">
                      <span className="text-ink">●</span> {t('progress.legend.best')}: {f.loadValue(p.best)} {f.unit}
                    </p>
                  </div>
                )
              }}
            />
            {average !== null && (
              <ReferenceLine
                y={average}
                stroke="var(--color-ink-faint)"
                strokeDasharray="4 4"
                ifOverflow="extendDomain"
              />
            )}
            <Line
              type="monotone"
              dataKey="best"
              stroke="var(--color-ink-faint)"
              strokeWidth={1.25}
              dot={{ r: 2.5, fill: 'var(--color-ink)', stroke: 'none' }}
              activeDot={{ r: 4, fill: 'var(--color-ink)', stroke: 'var(--color-surface)', strokeWidth: 2 }}
              connectNulls
              isAnimationActive={animate}
            />
            <Line
              type="monotone"
              dataKey="avg"
              stroke="var(--color-volt)"
              strokeWidth={2.5}
              dot={{ r: 3, fill: 'var(--color-volt)', stroke: 'none' }}
              activeDot={{ r: 5, fill: 'var(--color-volt)', stroke: 'var(--color-surface)', strokeWidth: 2 }}
              connectNulls
              isAnimationActive={animate}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-4 pt-2 text-[11px] text-ink-muted">
        <LegendKey className="h-[3px] w-3.5 rounded-full bg-volt">{t('progress.legend.avg')}</LegendKey>
        <LegendKey className="size-[7px] rounded-full bg-ink">{t('progress.legend.best')}</LegendKey>
        <LegendKey className="w-3.5 border-t border-dashed border-ink-faint">
          {t('progress.legend.periodAvg')} <span className="tabular text-ink">{f.estValue(average)}</span>
        </LegendKey>
      </figcaption>
    </figure>
  )
}

function LegendKey({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn('inline-block shrink-0', className)} />
      <span>{children}</span>
    </span>
  )
}

function History({ sessions, error }: { sessions: SessionSets[]; error: unknown }) {
  const { t } = useTranslation('exercises')
  const f = useFormat()
  const hasBodyweight = sessions.some((s) => s.groups.some((g) => g.weight === null))
  return (
    <div className="mt-6">
      <h3 className="eyebrow mb-2 px-1">{t('progress.history')}</h3>
      <ErrorNote error={error} className="mb-3" />
      {sessions.length > 0 && (
        <ul className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
          {sessions.map((s) => {
            const d = new Date(s.started_at)
            return (
              <li key={s.session_id} className="flex items-start gap-3 px-4 py-3">
                <time dateTime={s.started_at} className="w-10 shrink-0 text-center">
                  <span className="display tabular block text-[22px] leading-none">{f.date(d, 'd')}</span>
                  <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{f.date(d, 'MMM')}</span>
                </time>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[14px] leading-snug">
                    {s.groups.map((g, i) => (
                      <span key={i} className={cn('tabular whitespace-nowrap', g.warmup && 'text-ink-faint')}>
                        <span className={g.warmup ? '' : 'font-semibold text-ink'}>{g.weight === null ? t('progress.bodyweight') : f.load(g.weight)}</span>
                        {g.weight !== null && <span className="text-ink-faint"> {f.unit}</span>}
                        <span className={g.warmup ? '' : 'text-ink-muted'}>
                          {' '}
                          {g.count > 1 ? `${g.count}×${g.reps ?? '–'}` : `×${g.reps ?? '–'}`}
                        </span>
                        {g.warmup && <span className="sr-only"> ({t('progress.warmup')})</span>}
                      </span>
                    ))}
                  </p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {f.date(d, 'EEEE')} · {t('progress.sets', { count: s.workingSets })}
                  </p>
                </div>
                {s.topWeight !== null && (
                  <span className="shrink-0 pt-0.5 text-right">
                    <span className="tabular text-[15px] font-semibold">{f.load(s.topWeight)}</span>
                    <span className="text-xs text-ink-faint"> {f.unit}</span>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {hasBodyweight && <p className="mt-2 px-1 text-[11px] text-ink-faint">{t('progress.bodyweightHint')}</p>}
    </div>
  )
}

function EmptyProgress() {
  const { t } = useTranslation('exercises')
  return (
    <div className="hairline relative overflow-hidden rounded-[var(--radius-card)] bg-surface px-5 py-8">
      {/* a ghost of the chart that will appear here */}
      <svg aria-hidden viewBox="0 0 320 80" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-20 w-full opacity-60">
        <path d="M0 64 C 40 60, 60 52, 96 54 S 150 40, 188 38 S 250 26, 320 18" fill="none" stroke="var(--color-line-strong)" strokeWidth="2" strokeDasharray="5 6" />
      </svg>
      <div className="relative flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-volt/10 text-volt">
          <LineChartIcon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 pb-6">
          <p className="text-[17px] font-semibold leading-snug">{t('progress.empty.title')}</p>
          <p className="mt-1 max-w-[34ch] text-sm text-ink-muted">{t('progress.empty.body')}</p>
        </div>
      </div>
    </div>
  )
}
