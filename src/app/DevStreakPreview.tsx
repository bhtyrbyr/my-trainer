import { useParams } from 'react-router-dom'
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage'
import { StreakFlame } from '@/features/gamification/StreakFlame'

/** Dev-only: /__dev/streak/:n renders the dashboard header with a fake streak plus all tiers side by side. */
export function DevStreakPreview() {
  const n = Number(useParams().n ?? 0)
  return (
    <div>
      <DashboardPage preview={{ points: 845, streak: n }} />
      <div className="fixed inset-x-0 bottom-24 flex items-end justify-center gap-6">
        {[0, 3, 10, 20, 35, 60].map((d) => (
          <div key={d} className="flex flex-col items-center gap-1 text-xs text-ink-faint">
            <StreakFlame days={d} />
            {d}
          </div>
        ))}
      </div>
    </div>
  )
}
