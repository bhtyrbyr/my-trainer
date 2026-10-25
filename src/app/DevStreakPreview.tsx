import { useParams } from 'react-router-dom'
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage'
import { StreakFlame } from '@/features/gamification/StreakFlame'
import { StreakAvatar } from '@/features/gamification/StreakAvatar'
import { useAuth } from '@/features/auth/AuthProvider'
import { avatarUrl } from '@/features/profile/api'

const DAYS = [0, 3, 10, 20, 35, 60]

/** Dev-only: /__dev/streak/:n renders the dashboard header with a fake streak plus every tier side by side. */
export function DevStreakPreview() {
  const n = Number(useParams().n ?? 0)
  const { profile } = useAuth()
  const src = avatarUrl(profile?.avatar_path, profile?.updated_at)
  return (
    <div>
      <DashboardPage preview={{ points: 845, streak: n }} />
      <div className="fixed inset-x-0 bottom-24 space-y-8 px-4">
        <div className="flex items-end justify-between pr-2">
          {DAYS.map((d) => (
            <StreakAvatar key={d} src={src} streak={d} size={50} />
          ))}
        </div>
        <div className="flex items-end justify-between px-3">
          {DAYS.map((d) => (
            <div key={d} className="flex flex-col items-center gap-1 text-xs text-ink-faint">
              <StreakFlame days={d} />
              {d}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
