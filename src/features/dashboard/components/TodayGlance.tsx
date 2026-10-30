import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Loader2 } from 'lucide-react'
import { ErrorNote } from '@/components/ui/ErrorNote'
import {
  DEFAULT_WATER_GOAL,
  splitDuration,
  useAddWater,
  useSleepWeek,
  useWater,
  waterTotal,
} from '@/features/sleepwater'
import { useUserSettings } from '@/features/settings/hooks'
import { toLocalDateISO } from '@/lib/dates'
import { useTodayAgenda } from '../hooks'

/**
 * Today at a glance: a ruled list, one line per thing, each opening its module. The agenda (habits and
 * to-dos) is always there; water and last night's sleep only with health consent (otherwise the rows
 * are not rendered at all and their queries never run).
 */
export function TodayGlance({ health, base = '' }: { health: boolean; base?: string }) {
  const { t } = useTranslation('dashboard')
  return (
    <section
      aria-label={t('glance.label')}
      className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface"
    >
      <AgendaRow base={base} />
      {health && <WaterRow base={base} />}
      {health && <SleepRow base={base} />}
    </section>
  )
}

function Label({ children }: { children: string }) {
  return <span className="eyebrow w-[68px] shrink-0">{children}</span>
}

function AgendaRow({ base }: { base: string }) {
  const { t } = useTranslation('dashboard')
  const { data, isLoading } = useTodayAgenda()
  const nothing = data && data.habitsDue === 0 && data.todosDue === 0
  const todosLeft = data ? data.todosDue - data.todosDone : 0
  return (
    <Link
      to={`${base}/track`}
      aria-label={t('glance.open')}
      className="group flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-raised/50"
    >
      <Label>{t('glance.agenda')}</Label>
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[13px] text-ink-muted">
        {isLoading || !data ? (
          <span className="h-4 w-32 animate-pulse rounded bg-raised motion-reduce:animate-none" />
        ) : nothing ? (
          <span>{t('glance.nothing')}</span>
        ) : (
          <>
            {data.habitsDue > 0 && (
              <span>
                <span className="tabular text-[17px] font-semibold text-ink">
                  {data.habitsDone}
                  <span className="text-ink-faint">/{data.habitsDue}</span>
                </span>{' '}
                {t('glance.habits')}
              </span>
            )}
            {data.todosDue > 0 &&
              (todosLeft > 0 ? (
                <span className="tabular">{t('glance.todosLeft', { count: todosLeft })}</span>
              ) : (
                <span>
                  <span className="tabular text-[17px] font-semibold text-ink">{data.todosDone}</span>{' '}
                  {t('glance.todosDone')}
                </span>
              ))}
          </>
        )}
      </span>
      <ChevronRight className="size-4 shrink-0 text-ink-faint group-hover:text-ink" aria-hidden />
    </Link>
  )
}

function WaterRow({ base }: { base: string }) {
  const { t, i18n } = useTranslation(['dashboard', 'track'])
  const nf = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage === 'en' ? 'en' : 'tr'),
    [i18n.resolvedLanguage],
  )
  const today = toLocalDateISO()
  const water = useWater(today)
  const add = useAddWater()
  const { settings } = useUserSettings()
  const goal = settings?.daily_water_ml ?? DEFAULT_WATER_GOAL
  const ml = waterTotal(water.data ?? [])
  const pct = goal > 0 ? Math.min(100, (ml / goal) * 100) : 0
  return (
    <div>
      <div className="flex items-center gap-3 py-2 pl-4 pr-2">
        <Link
          to={`${base}/track/sleep-water`}
          aria-label={t('track:water.open')}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3"
        >
          <Label>{t('dashboard:glance.water')}</Label>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-1">
              <span className="tabular text-[17px] font-semibold">{nf.format(ml)}</span>
              <span className="tabular truncate text-[12px] text-ink-faint">/ {nf.format(goal)} ml</span>
            </span>
            <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-raised" aria-hidden>
              <span
                className="block h-full rounded-full bg-ink-muted transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </span>
          </span>
        </Link>
        <button
          type="button"
          aria-label={t('track:water.addLabel')}
          disabled={add.isPending}
          onClick={() => add.mutate({ day: today, ml: 250 })}
          className="hairline flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-raised px-3.5 text-[13px] font-semibold text-ink transition-colors hover:bg-raised/70 disabled:opacity-60"
        >
          {add.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {t('track:water.add')}
        </button>
      </div>
      <ErrorNote error={water.error ?? add.error} className="mx-4 mb-3" />
    </div>
  )
}

function SleepRow({ base }: { base: string }) {
  const { t } = useTranslation(['dashboard', 'sleepwater'])
  const today = toLocalDateISO()
  const sleep = useSleepWeek(today)
  // the night that ended this morning is stored on today's date
  const night = (sleep.data ?? []).find((n) => n.sleep_on === today) ?? null
  return (
    <Link
      to={`${base}/track/sleep-water`}
      className="group flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-raised/50"
    >
      <Label>{t('dashboard:glance.sleep')}</Label>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        {sleep.isLoading ? (
          <span className="h-4 w-24 animate-pulse rounded bg-raised motion-reduce:animate-none" />
        ) : night ? (
          <>
            <span className="tabular text-[17px] font-semibold">
              {t('sleepwater:sleep.duration', splitDuration(night.duration_min))}
            </span>
            {night.quality != null && (
              <span className="tabular text-[12px] text-ink-faint">
                {t('sleepwater:sleep.qualityN', { n: night.quality })}
              </span>
            )}
          </>
        ) : (
          <span className="text-[13px] text-ink-muted">{t('dashboard:glance.sleepNone')}</span>
        )}
      </span>
      {!sleep.isLoading && !night ? (
        <span className="shrink-0 text-[13px] font-semibold text-ink">{t('dashboard:glance.sleepLog')}</span>
      ) : (
        <ChevronRight className="size-4 shrink-0 text-ink-faint group-hover:text-ink" aria-hidden />
      )}
    </Link>
  )
}
