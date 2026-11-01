import { useTranslation } from 'react-i18next'
import { PageShell } from '@/components/layout/PageShell'
import { useAuth } from '@/features/auth/AuthProvider'
import { BadgeCelebration, type BadgeCode } from '@/features/badges'
import { WeeklyReviewCard } from '@/features/coach'
import { effectiveStreak } from '@/features/gamification/streak'
import { useConsents } from '@/features/privacy/hooks'
import { TodayWorkoutCard } from '@/features/workouts'
import { ProgressStrip } from '../components/ProgressStrip'
import { ScoreLine } from '../components/ScoreLine'
import { Suggestions, type SuggestionPreview } from '../components/Suggestions'
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
 * Home. One hero: today's workout. Above it a quiet level/streak line, under it one compact progress
 * strip (kcal, water, sleep, habits; the detailed tiles live in Track), then nudges, the week and the
 * coach's weekly review. On desktop: today on the left, the week on the right.
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
          <ScoreLine points={points} streak={streak} base={base} />
          <TodayWorkoutCard variant="dashboard" />
          <ProgressStrip health={health} base={base} eatenPreview={preview?.energy?.eaten} />
        </div>
        <div className="space-y-4">
          <Suggestions health={health} preview={preview?.suggest} base={base} />
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
