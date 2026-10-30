import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { parseISO } from 'date-fns'
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import { useUnits } from '@/features/settings/useUnits'
import { kgToDisplay, roundTo } from '@/lib/units'
import { cn } from '@/lib/utils'
import { useBodyFormat } from '../format'
import { filterPeriod, type WeightPoint } from '../logic'
import { WEIGHT_PERIODS, type WeightPeriod } from '../types'

/** values in the user's unit (kg or lb) */
type ChartPoint = { t: number; w: number; avg7: number }

/**
 * Trend. The 7-day average is the line that matters (volt); single weigh-ins are quiet dots because
 * day-to-day weight is mostly water. The target, if set, is a dashed rule.
 */
export function WeightTrend({ points, target: targetKg }: { points: WeightPoint[]; target: number | null }) {
  const { t } = useTranslation('body')
  const f = useBodyFormat()
  const u = useUnits()
  const toUnit = (kg: number) => kgToDisplay(kg, u.weight)
  const target = targetKg == null ? null : toUnit(targetKg)
  const [period, setPeriod] = useState<WeightPeriod>('3m')
  const [now] = useState(() => new Date())
  const [animate] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const rows = useMemo(() => filterPeriod(points, period, now), [points, period, now])
  const data: ChartPoint[] = rows.map((p) => ({ t: parseISO(p.day).getTime(), w: toUnit(p.kg), avg7: toUnit(p.avg7) }))

  const values = data.flatMap((d) => [d.w, d.avg7])
  if (target != null) values.push(target)
  const lo = values.length ? Math.min(...values) : 0
  const hi = values.length ? Math.max(...values) : 1
  const span = Math.max(hi - lo, 2)
  const step = span > 30 ? 10 : span > 12 ? 5 : span > 5 ? 2 : 1
  const yDomain: [number, number] = [Math.floor((lo - step * 0.5) / step) * step, Math.ceil((hi + step * 0.5) / step) * step]
  const first = data[0]?.t ?? 0
  const last = data[data.length - 1]?.t ?? 0
  const pad = first === last ? 3 * 86_400_000 : (last - first) * 0.04

  return (
    <section aria-labelledby="trend-title">
      <h2 id="trend-title" className="display mb-3 text-[22px]">
        {t('trend.title')}
      </h2>
      <div role="tablist" aria-label={t('trend.periodLabel')} className="hairline mb-3 grid grid-cols-4 rounded-full bg-surface p-1">
        {WEIGHT_PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={period === p}
            onClick={() => setPeriod(p)}
            className={cn('h-11 rounded-full text-[13px] font-medium transition-colors', period === p ? 'bg-raised text-ink' : 'text-ink-muted hover:text-ink')}
          >
            {t(`trend.period.${p}`)}
          </button>
        ))}
      </div>

      <figure aria-label={t('trend.chartLabel')} className="hairline overflow-hidden rounded-[var(--radius-card)] bg-surface">
        {data.length === 0 ? (
          <p className="px-4 py-14 text-center text-sm text-ink-muted">{t('trend.emptyPeriod')}</p>
        ) : (
          <div className="h-[200px] w-full pr-3 pt-3">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--color-line)" />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={[first - pad, last + pad]}
                  tickFormatter={(v: number) => f.time(v, 'd MMM')}
                  tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickCount={4}
                  minTickGap={24}
                />
                <YAxis
                  domain={yDomain}
                  allowDecimals={false}
                  tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  tickCount={4}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--color-line-strong)', strokeWidth: 1 }}
                  isAnimationActive={false}
                  content={({ active, payload }) => {
                    const p = active ? (payload?.[0]?.payload as ChartPoint | undefined) : undefined
                    if (!p) return null
                    return (
                      <div className="hairline rounded-[var(--radius-input)] bg-raised px-3 py-2 text-xs">
                        <p className="mb-1 font-semibold text-ink">{f.time(p.t, 'd MMM yyyy')}</p>
                        <p className="tabular text-ink-muted">
                          {t('trend.legendDaily')}: <span className="text-ink">{u.bodyValue(p.w)} {u.weightLabel}</span>
                        </p>
                        <p className="tabular text-ink-muted">
                          <span className="text-volt">●</span> {t('trend.legendAvg')}: {u.oneDecimal(roundTo(p.avg7, 1))} {u.weightLabel}
                        </p>
                      </div>
                    )
                  }}
                />
                {target != null && <ReferenceLine y={target} stroke="var(--color-ink-faint)" strokeDasharray="4 4" ifOverflow="extendDomain" />}
                <Scatter
                  dataKey="w"
                  isAnimationActive={false}
                  legendType="none"
                  shape={(props: { cx?: number; cy?: number }) => <circle cx={props.cx} cy={props.cy} r={2} fill="var(--color-ink-faint)" />}
                />
                <Line
                  type="monotone"
                  dataKey="avg7"
                  stroke="var(--color-volt)"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5, fill: 'var(--color-volt)', stroke: 'var(--color-surface)', strokeWidth: 2 }}
                  isAnimationActive={animate}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-3 text-[11px] text-ink-muted">
          <Key className="size-[6px] rounded-full bg-ink-muted">{t('trend.legendDaily')}</Key>
          <Key className="h-[3px] w-3.5 rounded-full bg-volt">{t('trend.legendAvg')}</Key>
          {target != null && (
            <Key className="w-3.5 border-t border-dashed border-ink-faint">
              {t('trend.legendTarget')} <span className="tabular text-ink">{u.bodyValue(target)}</span>
            </Key>
          )}
        </figcaption>
      </figure>
    </section>
  )
}

function Key({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={className} />
      {children}
    </span>
  )
}
