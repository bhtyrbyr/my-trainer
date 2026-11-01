import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useEatenOn } from '@/features/nutrition'
import { useUserSettings } from '@/features/settings/hooks'
import { DEFAULT_WATER_GOAL, splitDuration, useSleepWeek, useWater, waterTotal } from '@/features/sleepwater'
import { toLocalDateISO } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useTodayAgenda } from '../hooks'

type Props = { health: boolean; base?: string; eatenPreview?: { kcal: number; entries: number } }

/**
 * Today in one quiet line: four small figures (kcal, water, sleep, habits), each opening its Track
 * screen. The detailed tiles live in Track; Home keeps a single hero (today's workout). Without health
 * consent only the agenda figures render and the health queries never run.
 */
export function ProgressStrip({ health, base = '', eatenPreview }: Props) {
  const { t } = useTranslation('dashboard')
  return (
    <section
      aria-label={t('strip.label')}
      className={cn('hairline grid divide-x divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface', health ? 'grid-cols-4' : 'grid-cols-2')}
    >
      {health && <KcalCell base={base} preview={eatenPreview} />}
      {health && <WaterCell base={base} />}
      {health && <SleepCell base={base} />}
      <HabitsCell base={base} />
      {!health && <TodosCell base={base} />}
    </section>
  )
}

function Cell({ to, value, unit, label, loading }: { to: string; value: string; unit?: string; label: string; loading?: boolean }) {
  return (
    <Link
      to={to}
      aria-label={`${label}: ${value}${unit ? ` ${unit}` : ''}`}
      className="flex min-h-[72px] min-w-0 flex-col justify-center px-3 py-3 transition-colors hover:bg-raised/50"
    >
      {loading ? (
        <span className="h-5 w-12 animate-pulse rounded bg-raised motion-reduce:animate-none" />
      ) : (
        <span className="flex min-w-0 items-baseline gap-0.5">
          <span className="display tabular truncate text-[20px] leading-none">{value}</span>
          {unit && <span className="shrink-0 text-[11px] font-medium text-ink-faint">{unit}</span>}
        </span>
      )}
      <span className="mt-1.5 truncate text-[12px] text-ink-muted">{label}</span>
    </Link>
  )
}

function useNf() {
  const { i18n } = useTranslation()
  return useMemo(() => new Intl.NumberFormat(i18n.resolvedLanguage === 'en' ? 'en' : 'tr'), [i18n.resolvedLanguage])
}

function KcalCell({ base, preview }: { base: string; preview?: { kcal: number; entries: number } }) {
  const { t } = useTranslation('dashboard')
  const nf = useNf()
  const eaten = useEatenOn(undefined, preview)
  return <Cell to={`${base}/track/nutrition`} value={nf.format(eaten.data?.kcal ?? 0)} label={t('strip.kcal')} loading={eaten.isLoading} />
}

function WaterCell({ base }: { base: string }) {
  const { t } = useTranslation('dashboard')
  const nf = useNf()
  const water = useWater(toLocalDateISO())
  const { settings } = useUserSettings()
  const goal = settings?.daily_water_ml ?? DEFAULT_WATER_GOAL
  const pct = goal > 0 ? Math.round((waterTotal(water.data ?? []) / goal) * 100) : 0
  return <Cell to={`${base}/track/sleep-water`} value={nf.format(pct)} unit="%" label={t('strip.water')} loading={water.isLoading} />
}

function SleepCell({ base }: { base: string }) {
  const { t } = useTranslation('dashboard')
  const today = toLocalDateISO()
  const sleep = useSleepWeek(today)
  // the night that ended this morning is stored on today's date
  const night = (sleep.data ?? []).find((n) => n.sleep_on === today)
  const d = night ? splitDuration(night.duration_min) : null
  return (
    <Cell
      to={`${base}/track/sleep-water`}
      value={d ? `${d.h}:${String(d.m).padStart(2, '0')}` : '–'}
      label={t('strip.sleep')}
      loading={sleep.isLoading}
    />
  )
}

function HabitsCell({ base }: { base: string }) {
  const { t } = useTranslation('dashboard')
  const { data, isLoading } = useTodayAgenda()
  return (
    <Cell
      to={`${base}/track`}
      value={data && data.habitsDue > 0 ? `${data.habitsDone}/${data.habitsDue}` : '–'}
      label={t('strip.habits')}
      loading={isLoading || !data}
    />
  )
}

function TodosCell({ base }: { base: string }) {
  const { t } = useTranslation('dashboard')
  const { data, isLoading } = useTodayAgenda()
  return (
    <Cell
      to={`${base}/track`}
      value={data && data.todosDue > 0 ? `${data.todosDone}/${data.todosDue}` : '–'}
      label={t('strip.todos')}
      loading={isLoading || !data}
    />
  )
}
