import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarCheck, Droplet, Dumbbell, Flame, Scale, X, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { DEFAULT_WATER_GOAL, useWater, waterTotal } from '@/features/sleepwater'
import { useBodyMetrics } from '@/features/body'
import { useVocab } from '@/features/exercises'
import { effectiveStreak } from '@/features/gamification/streak'
import { useUserSettings } from '@/features/settings/hooks'
import { toLocalDateISO } from '@/lib/dates'
import { useDismissedSuggestions, useTodayAgenda, useTrainedParts } from '../hooks'
import { pickSuggestions, type Suggestion, type SuggestionInput } from '../logic'

const ICON: Record<Suggestion['kind'], LucideIcon> = {
  streak: Flame,
  habits: CalendarCheck,
  water: Droplet,
  muscle: Dumbbell,
  weigh: Scale,
}

export type SuggestionPreview = { now?: Date; streak?: number; lastActiveOn?: string | null }

/**
 * Rule-based nudges (at most two, each hideable for the day). Health rules only run with consent: the
 * health hooks live in their own component so they are never even called without it.
 */
export function Suggestions({
  health,
  preview,
  base = '',
}: {
  health: boolean
  preview?: SuggestionPreview
  base?: string
}) {
  return health ? (
    <WithHealth preview={preview} base={base} />
  ) : (
    <SuggestionList health={null} preview={preview} base={base} />
  )
}

function WithHealth({ preview, base }: { preview?: SuggestionPreview; base: string }) {
  const water = useWater(toLocalDateISO())
  const metrics = useBodyMetrics()
  const { settings } = useUserSettings()
  const signals =
    water.data && metrics.data
      ? {
          waterMl: waterTotal(water.data),
          waterGoal: settings?.daily_water_ml ?? DEFAULT_WATER_GOAL,
          lastWeighIn: metrics.data.find((r) => r.weight_kg != null)?.measured_on ?? null,
        }
      : null
  return <SuggestionList health={signals} preview={preview} base={base} />
}

function SuggestionList({
  health,
  preview,
  base,
}: {
  health: SuggestionInput['health']
  preview?: SuggestionPreview
  base: string
}) {
  const { t } = useTranslation('dashboard')
  const vocab = useVocab()
  const { profile } = useAuth()
  const agenda = useTodayAgenda()
  const parts = useTrainedParts()
  const { dismissed, dismiss } = useDismissedSuggestions()

  const now = preview?.now ?? new Date()
  const list = pickSuggestions(
    {
      now,
      today: toLocalDateISO(now),
      streak: preview?.streak ?? effectiveStreak(profile?.current_streak, profile?.last_active_on),
      lastActiveOn:
        preview && 'lastActiveOn' in preview
          ? (preview.lastActiveOn ?? null)
          : (profile?.last_active_on ?? null),
      habitsOpen: agenda.data ? agenda.data.habitsDue - agenda.data.habitsDone : null,
      trainedParts: parts.data ?? null,
      health,
    },
    dismissed,
  )
  if (list.length === 0) return null

  const text = (s: Suggestion): { lead: string; body: string; to: string } => {
    switch (s.kind) {
      case 'streak':
        return {
          lead: t('suggest.streak.lead'),
          body: t('suggest.streak.body', { count: s.streak }),
          to: `${base}/track`,
        }
      case 'habits':
        return {
          lead: t('suggest.habits.lead'),
          body: t('suggest.habits.body', { count: s.open }),
          to: `${base}/track`,
        }
      case 'water':
        return {
          lead: t('suggest.water.lead'),
          body: t('suggest.water.body', { pct: s.pct }),
          to: `${base}/track/sleep-water`,
        }
      case 'muscle':
        return {
          lead: t('suggest.muscle.lead', { part: vocab.bodyPart(s.part) }),
          body: t('suggest.muscle.body', { count: s.days }),
          to: `${base}/workouts`,
        }
      case 'weigh':
        return {
          lead: t('suggest.weigh.lead'),
          body: t('suggest.weigh.body', { count: s.days }),
          to: `${base}/track/body`,
        }
    }
  }

  return (
    <section aria-label={t('suggest.label')}>
      <ul className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
        {list.map((s, i) => {
          const Icon = ICON[s.kind]
          const { lead, body, to } = text(s)
          return (
            <li key={s.id} className="rise-in flex items-center" style={{ '--i': i } as React.CSSProperties}>
              <Link
                to={to}
                className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-1 transition-colors hover:bg-raised/50"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-ink-muted">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="text-[14px] leading-snug text-ink-muted">
                  <span className="font-semibold text-ink">{lead}</span> {body}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => dismiss(s.id)}
                aria-label={`${t('suggest.dismiss')}: ${lead}`}
                title={t('suggest.dismiss')}
                className="mr-1 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-raised hover:text-ink"
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
