import { useTranslation } from 'react-i18next'
import { PageShell } from '@/components/layout/PageShell'
import { useAuth } from '@/features/auth/AuthProvider'
import { BadgeCelebration, type BadgeCode } from '@/features/badges'
import { WeeklyReviewCard } from '@/features/coach'
import { ScoreHero } from '@/features/gamification/ScoreHero'
import { effectiveStreak } from '@/features/gamification/streak'
import { useConsents } from '@/features/privacy/hooks'
import { TodayWorkoutCard } from '@/features/workouts'
import { DailyEnergyCard } from '../components/DailyEnergyCard'
import { Suggestions, type SuggestionPreview } from '../components/Suggestions'
import { TodayGlance } from '../components/TodayGlance'
import { WeekSummary } from '../components/WeekSummary'

type Preview = {
  points: number
  streak: number
  energy?: { burned: { kcal: number; sessions: number }; eaten: { kcal: number; entries: number } }
  /** dev previews: health consent, the clock and last active day for the suggestions, a forced celebration */
  health?: boolean
  suggest?: SuggestionPreview
  celebrate?: BadgeCode[]
  base?: string
}

/**
 * Home. Today first (score, nudges, the workout, energy, the day's list), then the week and the coach's
 * weekly review (on tap only). On desktop the
 * same blocks split into two columns: today on the left, the week on the right.
 */
export function DashboardPage({ preview }: { preview?: Preview }) {
  const { t } = useTranslation('common')
  const { profile } = useAuth()
  const consents = useConsents()
  const points = preview?.points ?? profile?.total_points ?? 0
  const streak = preview?.streak ?? effectiveStreak(profile?.current_streak, profile?.last_active_on)
  // KVKK art. 6: health-dependent parts render only with explicit consent (nothing while it loads)
  const health = preview?.health ?? (!consents.isLoading && consents.health)
  const base = preview?.base ?? ''

  return (
    <PageShell title={t('nav.home')} bare className="pt-3">
      <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 lg:space-y-0">
        <div className="space-y-4">
          <ScoreHero points={points} streak={streak} />
          <Suggestions health={health} preview={preview?.suggest} base={base} />
          <TodayWorkoutCard variant="dashboard" />
          <DailyEnergyCard preview={preview?.energy} />
        </div>
        <div className="space-y-4">
          <TodayGlance health={health} base={base} />
          <div className="pt-2 lg:pt-0">
            <WeekSummary />
          </div>
          <WeeklyReviewCard base={base} />
        </div>
      </div>
      <BadgeCelebration preview={preview?.celebrate} />
    </PageShell>
  )
}
