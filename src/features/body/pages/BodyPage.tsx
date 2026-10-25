import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, ChevronRight, Loader2, Plus, TrendingDown, TrendingUp } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { Stepper } from '@/features/workouts'
import { toLocalDateISO } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { LogSheet } from '../components/LogSheet'
import { HeightSheet } from '../components/HeightSheet'
import { TargetSheet } from '../components/TargetSheet'
import { WeightTrend } from '../components/WeightTrend'
import { useBodyFormat } from '../format'
import { useBodyMetrics, usePrivateWeights, useSaveBodyMetric } from '../hooks'
import {
  bmi,
  filterPeriod,
  hasMeasurements,
  latestMeasurements,
  navyBodyFat,
  summarizeWeight,
  weightSeries,
  type MeasureRow,
} from '../logic'
import { useIsBodyPreview } from '../previewContext'
import { MEASURE_FIELDS, type BodyMetric } from '../types'

/**
 * Body. Point of view: the scale reading. The last weigh-in is set like a display on a scale; the
 * 7-day average and the distance to target sit under it as the honest numbers. Logging today is one
 * stepper and one button right below; trend, measurements and the entry log follow.
 */
export function BodyPage() {
  const { t } = useTranslation('body')
  const preview = useIsBodyPreview()
  const metrics = useBodyMetrics()
  const target = usePrivateWeights()
  // ?log=YYYY-MM-DD (from the Track day view) opens the entry sheet for that day
  const [params, setParams] = useSearchParams()
  const logParam = params.get('log')
  const [sheetDay, setSheetDay] = useState<string | null>(() =>
    logParam && /^\d{4}-\d{2}-\d{2}$/.test(logParam) && logParam <= toLocalDateISO() ? logParam : null,
  )
  const [targetOpen, setTargetOpen] = useState(false)
  const [heightOpen, setHeightOpen] = useState(false)

  const rows = useMemo(() => metrics.data ?? [], [metrics.data])
  const points = useMemo(() => weightSeries(rows), [rows])
  const targetKg = target.data?.target ?? null
  const latestWeight = points.length ? points[points.length - 1].kg : (target.data?.start ?? null)

  return (
    <PageShell
      title={t('title')}
      leading={
        <div className="flex items-center gap-1">
          <Link
            to={preview ? '/__dev/track' : '/track'}
            aria-label={t('back')}
            className="-ml-2 flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <span className="text-lg font-bold tracking-tight">{t('title')}</span>
        </div>
      }
    >
      <ErrorNote error={metrics.error ?? target.error} className="mb-4" />
      {metrics.isLoading || target.isLoading ? (
        <div
          className="h-[420px] animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none"
          aria-busy="true"
        />
      ) : (
        <div className="space-y-10 pb-6 lg:grid lg:grid-cols-2 lg:gap-10 lg:space-y-0">
          <div className="space-y-6">
            <Hero
              points={points}
              target={targetKg}
              height={target.data?.height ?? null}
              onTarget={() => setTargetOpen(true)}
              onHeight={() => setHeightOpen(true)}
            />
            <QuickLog rows={rows} lastWeight={latestWeight} onMore={() => setSheetDay(toLocalDateISO())} />
          </div>
          <div className="space-y-10">
            {points.length > 0 && <WeightTrend points={points} target={targetKg} />}
            <Measurements
              rows={rows}
              sex={target.data?.sex ?? null}
              height={target.data?.height ?? null}
              onAdd={() => setSheetDay(toLocalDateISO())}
              onHeight={() => setHeightOpen(true)}
            />
            <Entries rows={rows} onOpen={setSheetDay} />
          </div>
        </div>
      )}

      <LogSheet
        open={sheetDay !== null}
        day={sheetDay ?? toLocalDateISO()}
        rows={rows}
        lastWeight={latestWeight}
        onClose={() => {
          setSheetDay(null)
          if (logParam) setParams({}, { replace: true })
        }}
      />
      <HeightSheet
        open={heightOpen}
        current={target.data?.height ?? null}
        onClose={() => setHeightOpen(false)}
      />
      <TargetSheet
        open={targetOpen}
        current={targetKg}
        suggestion={latestWeight}
        onClose={() => setTargetOpen(false)}
      />
    </PageShell>
  )
}

function Hero({
  points,
  target,
  height,
  onTarget,
  onHeight,
}: {
  points: ReturnType<typeof weightSeries>
  target: number | null
  height: number | null
  onTarget: () => void
  onHeight: () => void
}) {
  const { t } = useTranslation('body')
  const f = useBodyFormat()
  const [now] = useState(() => new Date())
  const month = filterPeriod(points, '1m', now)
  const s = summarizeWeight(month.length >= 2 ? month : points, target)

  if (!s.latest) {
    return (
      <section className="rise-in pt-2">
        <p className="display text-[30px] leading-tight">{t('hero.empty')}</p>
        <p className="mt-2 text-[15px] text-ink-muted">{t('hero.emptyHint')}</p>
      </section>
    )
  }

  const periodLabel = t(`trend.period.${month.length >= 2 ? '1m' : 'all'}`)
  return (
    <section className="rise-in pt-2" aria-label={t('title')}>
      <p className="eyebrow">{t('hero.eyebrow', { date: f.day(s.latest.day, 'd MMM') })}</p>
      <p className="mt-3 flex items-baseline gap-2">
        <span className="display tabular text-[88px] leading-[0.85] tracking-[-0.05em]">
          {f.num(s.latest.kg)}
        </span>
        <span className="text-[20px] font-medium text-ink-muted">{t('units.kg')}</span>
      </p>

      <dl className="mt-6 grid grid-cols-2 border-y border-line">
        <div className="flex flex-col-reverse py-3.5 pr-3">
          <dt className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
            {t('hero.avg7')}
          </dt>
          <dd className="tabular text-[20px] font-semibold leading-none">
            {f.num(s.latest.avg7)}{' '}
            <span className="text-[13px] font-medium text-ink-faint">{t('units.kg')}</span>
          </dd>
        </div>
        <div className="flex flex-col-reverse border-l border-line py-3.5 pl-4">
          <dt className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
            {periodLabel}
          </dt>
          <dd className="tabular flex items-center gap-1.5 text-[20px] font-semibold leading-none">
            {s.change != null && s.change < 0 && (
              <TrendingDown className="size-4 text-ink-muted" aria-hidden />
            )}
            {s.change != null && s.change > 0 && <TrendingUp className="size-4 text-ink-muted" aria-hidden />}
            {s.change == null || s.change === 0 ? (
              '–'
            ) : (
              <>
                {f.signed(s.change)}{' '}
                <span className="text-[13px] font-medium text-ink-faint">{t('units.kg')}</span>
              </>
            )}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={onTarget}
        className="group mt-1 flex h-12 w-full items-center justify-between gap-3 text-left"
      >
        {target == null ? (
          <span className="text-[14px] font-medium text-ink-muted group-hover:text-ink">
            {t('hero.addTarget')}
          </span>
        ) : (
          <span className="tabular text-[14px] text-ink-muted">
            <span className="font-semibold text-ink">{t('hero.target', { kg: f.num(target) })}</span>
            <span className="mx-2 text-ink-faint">·</span>
            {s.toTarget === 0 || s.toTarget == null
              ? t('hero.atTarget')
              : s.toTarget > 0
                ? t('hero.toTargetAbove', { kg: f.num(s.toTarget) })
                : t('hero.toTargetBelow', { kg: f.num(-s.toTarget) })}
          </span>
        )}
        <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
      </button>
      <BmiRow kg={s.latest.kg} height={height} onEdit={onHeight} />
    </section>
  )
}

function BmiRow({ kg, height, onEdit }: { kg: number; height: number | null; onEdit: () => void }) {
  const { t } = useTranslation('body')
  const f = useBodyFormat()
  const b = bmi(kg, height)
  return (
    <button
      type="button"
      onClick={onEdit}
      className="group flex min-h-12 w-full items-center justify-between gap-3 border-t border-line py-2 text-left"
    >
      {b && height ? (
        <span className="tabular text-[14px] text-ink-muted">
          <span className="font-semibold text-ink">
            {t('bmi.label')} {f.num(b.value)}
          </span>
          <span className="mx-2 text-ink-faint">·</span>
          {t(`bmi.category.${b.category}`)}
          <span className="mx-2 text-ink-faint">·</span>
          {t('height.value', { cm: Math.round(height) })}
        </span>
      ) : (
        <span className="text-[14px] font-medium text-ink-muted group-hover:text-ink">
          {t('bmi.needHeight')}
        </span>
      )}
      <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
    </button>
  )
}

function QuickLog({
  rows,
  lastWeight,
  onMore,
}: {
  rows: BodyMetric[]
  lastWeight: number | null
  onMore: () => void
}) {
  const { t } = useTranslation('body')
  const f = useBodyFormat()
  const save = useSaveBodyMetric()
  const today = toLocalDateISO()
  const todayRow = rows.find((r) => r.measured_on === today)
  const saved = todayRow?.weight_kg != null ? Number(todayRow.weight_kg) : null
  const [value, setValue] = useState<number | null>(saved ?? lastWeight ?? 70)
  const dirty = value != null && value !== saved

  return (
    <section className="hairline rounded-[var(--radius-card)] bg-surface p-5" aria-labelledby="quick-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="quick-title" className="eyebrow">
          {t('quick.today')}
        </h2>
        {saved != null && !dirty && (
          <span className="flex items-center gap-1 text-[12px] font-semibold text-volt">
            <Check className="size-3.5" aria-hidden />
            {t('quick.saved')}
          </span>
        )}
      </div>
      <Stepper
        label={t('quick.today')}
        value={value}
        onChange={setValue}
        step={0.1}
        min={20}
        max={400}
        decimal
        unit={t('units.kg')}
        format={f.num}
        decLabel={t('quick.weightDec')}
        incLabel={t('quick.weightInc')}
        className="mt-3 [&>label]:sr-only"
      />
      <ErrorNote error={save.error} className="mt-3" />
      <Button
        size="lg"
        className="mt-4 w-full"
        disabled={!dirty || save.isPending}
        onClick={() => value != null && save.mutate({ measured_on: today, weight_kg: value })}
      >
        {save.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
        {saved != null ? t('quick.update') : t('quick.save')}
      </Button>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-[12px] text-ink-faint">{t('quick.points')}</p>
        <button
          type="button"
          onClick={onMore}
          className="flex h-11 shrink-0 items-center gap-1 text-[13px] font-medium text-ink-muted hover:text-ink"
        >
          <Plus className="size-4" aria-hidden />
          {t('quick.more')}
        </button>
      </div>
    </section>
  )
}

function Measurements({
  rows,
  sex,
  height,
  onAdd,
  onHeight,
}: {
  rows: BodyMetric[]
  sex: string | null
  height: number | null
  onAdd: () => void
  onHeight: () => void
}) {
  const { t } = useTranslation('body')
  const f = useBodyFormat()
  const list = latestMeasurements(rows)
  const get = (k: string) => list.find((m) => m.field === k)?.value ?? null
  const fat = navyBodyFat({
    sex,
    heightCm: height,
    neckCm: get('neck_cm'),
    waistCm: get('waist_cm'),
    hipCm: get('hip_cm'),
  })
  const any = list.some((m) => m.value != null)
  return (
    <section aria-labelledby="measure-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="measure-title" className="display text-[22px]">
          {t('measure.title')}
        </h2>
        <Button variant="ghost" size="sm" className="h-11" onClick={onAdd}>
          <Plus className="size-4" aria-hidden />
          {t('measure.add')}
        </Button>
      </div>
      <div className="hairline mb-3 rounded-[var(--radius-card)] bg-surface p-4">
        <p className="eyebrow">{t('fat.title')}</p>
        {fat.ok ? (
          <>
            <p className="mt-2.5 flex items-baseline gap-1.5">
              <span className="text-[18px] text-ink-faint">≈</span>
              <span className="display tabular text-[40px] leading-none">%{f.num(fat.value)}</span>
              <span className="ml-1 text-[14px] font-medium text-ink-muted">
                {t(`fat.category.${fat.category}`)}
              </span>
            </p>
            <p className="mt-2 text-[12px] leading-snug text-ink-faint">{t('fat.method')}</p>
          </>
        ) : (
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-[13px] leading-snug text-ink-muted">
              {fat.invalid
                ? t('fat.invalid')
                : t('fat.needs', { list: fat.missing.map((m) => t(`fat.missing.${m}`)).join(', ') })}
            </p>
            {!fat.invalid &&
              (fat.missing.includes('height') ? (
                <Button variant="secondary" size="sm" className="h-11 shrink-0" onClick={onHeight}>
                  {t('height.add')}
                </Button>
              ) : fat.missing.some((m) => m !== 'sex') ? (
                <Button variant="secondary" size="sm" className="h-11 shrink-0" onClick={onAdd}>
                  {t('measure.add')}
                </Button>
              ) : null)}
          </div>
        )}
      </div>
      {!any ? (
        <p className="hairline rounded-[var(--radius-card)] bg-surface px-4 py-6 text-[14px] text-ink-muted">
          {t('measure.empty')}
        </p>
      ) : (
        <ul className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
          {list.map((m) => (
            <MeasureLine key={m.field} m={m} label={t(`measure.fields.${m.field}`)} f={f} />
          ))}
        </ul>
      )}
    </section>
  )
}

function MeasureLine({ m, label, f }: { m: MeasureRow; label: string; f: ReturnType<typeof useBodyFormat> }) {
  const { t } = useTranslation('body')
  return (
    <li className="flex h-14 items-center gap-3 px-4">
      <span className="flex-1 text-[15px] font-medium">{label}</span>
      {m.delta != null && m.delta !== 0 && (
        <span className="tabular text-[12px] text-ink-faint" title={t('measure.since')}>
          {f.signed(m.delta)}
        </span>
      )}
      <span
        className={cn(
          'tabular w-24 text-right text-[17px] font-semibold',
          m.value == null && 'text-ink-faint',
        )}
      >
        {m.value == null ? '–' : f.num(m.value)}
        {m.value != null && (
          <span className="ml-1 text-[12px] font-medium text-ink-faint">{t('units.cm')}</span>
        )}
      </span>
    </li>
  )
}

function Entries({ rows, onOpen }: { rows: BodyMetric[]; onOpen: (day: string) => void }) {
  const { t } = useTranslation('body')
  const f = useBodyFormat()
  if (rows.length === 0) return null
  return (
    <section aria-labelledby="entries-title">
      <h2 id="entries-title" className="display mb-3 text-[22px]">
        {t('entries.title')}
      </h2>
      <ul className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
        {rows.slice(0, 60).map((r) => {
          const count = MEASURE_FIELDS.filter((k) => r[k] != null).length
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onOpen(r.measured_on)}
                aria-label={t('entries.edit', { date: f.day(r.measured_on, 'd MMMM yyyy') })}
                className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-raised/50"
              >
                <span className="w-10 shrink-0 text-center">
                  <span className="display tabular block text-[22px] leading-none">
                    {f.day(r.measured_on, 'd')}
                  </span>
                  <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                    {f.day(r.measured_on, 'MMM')}
                  </span>
                </span>
                <span className="tabular flex-1 text-[15px] font-semibold">
                  {r.weight_kg != null ? (
                    `${f.num(Number(r.weight_kg))} ${t('units.kg')}`
                  ) : (
                    <span className="font-normal text-ink-faint">–</span>
                  )}
                </span>
                {hasMeasurements(r) && (
                  <span className="text-[13px] text-ink-muted">{t('entries.measures', { count })}</span>
                )}
                <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
