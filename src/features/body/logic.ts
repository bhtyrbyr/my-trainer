import { addDays, parseISO, subMonths, subYears } from 'date-fns'
import { MEASURE_FIELDS, type BodyMetric, type MeasureField, type WeightPeriod } from './types'

export type WeightPoint = { day: string; kg: number; avg7: number }

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Weight series, oldest first, with a trailing 7-calendar-day average at each point
 * (the logged days within [day - 6, day]). Days without a weight are skipped.
 */
export function weightSeries(rows: Pick<BodyMetric, 'measured_on' | 'weight_kg'>[]): WeightPoint[] {
  const pts = rows
    .filter((r): r is { measured_on: string; weight_kg: number } => r.weight_kg != null)
    .map((r) => ({ day: r.measured_on, kg: Number(r.weight_kg) }))
    .sort((a, b) => a.day.localeCompare(b.day))
  return pts.map((p, i) => {
    const from = addDays(parseISO(p.day), -6).getTime()
    let sum = 0
    let n = 0
    for (let j = i; j >= 0 && parseISO(pts[j].day).getTime() >= from; j--) {
      sum += pts[j].kg
      n++
    }
    return { ...p, avg7: round1(sum / n) }
  })
}

export function periodStart(period: WeightPeriod, now: Date): Date | null {
  if (period === '1m') return subMonths(now, 1)
  if (period === '3m') return subMonths(now, 3)
  if (period === '1y') return subYears(now, 1)
  return null
}

export function filterPeriod(points: WeightPoint[], period: WeightPeriod, now: Date): WeightPoint[] {
  const start = periodStart(period, now)
  if (!start) return points
  return points.filter((p) => parseISO(p.day).getTime() >= start.getTime() - 86_400_000)
}

export type WeightSummary = {
  latest: WeightPoint | null
  /** change of the 7-day average across the visible period (null with fewer than 2 points) */
  change: number | null
  /** latest weight minus target (positive: above target) */
  toTarget: number | null
}

export function summarizeWeight(points: WeightPoint[], target: number | null): WeightSummary {
  const latest = points.length ? points[points.length - 1] : null
  const first = points[0]
  return {
    latest,
    change: points.length >= 2 && latest && first ? round1(latest.avg7 - first.avg7) : null,
    toTarget: latest && target != null ? round1(latest.kg - target) : null,
  }
}

export type MeasureRow = { field: MeasureField; value: number | null; day: string | null; delta: number | null }

/** Latest value of each circumference and the change since its previous logged value. */
export function latestMeasurements(rows: BodyMetric[]): MeasureRow[] {
  const sorted = [...rows].sort((a, b) => b.measured_on.localeCompare(a.measured_on))
  return MEASURE_FIELDS.map((field) => {
    const logged = sorted.filter((r) => r[field] != null)
    const [cur, prev] = logged
    const value = cur ? Number(cur[field]) : null
    return {
      field,
      value,
      day: cur?.measured_on ?? null,
      delta: cur && prev ? round1(Number(cur[field]) - Number(prev[field])) : null,
    }
  })
}

export const hasMeasurements = (r: Pick<BodyMetric, MeasureField>) => MEASURE_FIELDS.some((f) => r[f] != null)

export type BmiCategory = 'under' | 'normal' | 'over' | 'obese'

/** Body mass index (kg / m², one decimal) and its WHO adult category; null without weight or height. */
export function bmi(weightKg: number | null | undefined, heightCm: number | null | undefined): { value: number; category: BmiCategory } | null {
  if (!weightKg || !heightCm || heightCm < 50) return null
  const m = heightCm / 100
  const value = Math.round((weightKg / (m * m)) * 10) / 10
  const category: BmiCategory = value < 18.5 ? 'under' : value < 25 ? 'normal' : value < 30 ? 'over' : 'obese'
  return { value, category }
}

/** Latest weigh-in on or before `day` (YYYY-MM-DD). */
export function latestWeightOnOrBefore(rows: Pick<BodyMetric, 'measured_on' | 'weight_kg'>[], day: string): { day: string; kg: number } | null {
  let best: { day: string; kg: number } | null = null
  for (const r of rows) {
    if (r.weight_kg == null || r.measured_on > day) continue
    if (!best || r.measured_on > best.day) best = { day: r.measured_on, kg: Number(r.weight_kg) }
  }
  return best
}
