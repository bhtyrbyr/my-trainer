import { useTranslation } from 'react-i18next'
import { PageShell } from '@/components/layout/PageShell'
import { useAuth } from '@/features/auth/AuthProvider'
import { ScoreHero } from '@/features/gamification/ScoreHero'
import { effectiveStreak } from '@/features/gamification/streak'
import { TodayWorkoutCard } from '@/features/workouts'
import { DailyEnergyCard } from '../components/DailyEnergyCard'

export function DashboardPage({ preview }: { preview?: { points: number; streak: number; burned?: { kcal: number; sessions: number } } }) {
  const { t } = useTranslation('common')
  const { profile } = useAuth()
  const points = preview?.points ?? profile?.total_points ?? 0
  const streak = preview?.streak ?? effectiveStreak(profile?.current_streak, profile?.last_active_on)
  return (
    <PageShell title={t('nav.home')} bare className="space-y-4 pt-3">
      <ScoreHero points={points} streak={streak} />
      <TodayWorkoutCard variant="dashboard" />
      <DailyEnergyCard preview={preview?.burned} />
      {/* water, nutrition, sleep and the weekly summary arrive in phase 4 */}
      <p className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-dashed border-line px-4 py-3 text-[13px] text-ink-faint">
        <span>{t('comingSoon')}</span>
        <span className="shrink-0 rounded-full bg-raised px-2.5 py-0.5 text-[11px] font-medium text-ink-muted">{t('phase', { n: 4 })}</span>
      </p>
    </PageShell>
  )
}
