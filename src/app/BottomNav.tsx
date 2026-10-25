import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarCheck, Dumbbell, LayoutDashboard, LineChart, Trophy, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePendingCount } from '@/features/admin/hooks'

/**
 * Six tabs; the profile tab sits at the far right and replaces the old header avatar/gear.
 * On iPhone 16 (393pt) each tab is ~65pt wide, still above the 44pt touch target.
 */
const tabs = [
  { to: '/', key: 'home', icon: LayoutDashboard },
  { to: '/workouts', key: 'workouts', icon: Dumbbell },
  { to: '/track', key: 'track', icon: LineChart },
  { to: '/today', key: 'today', icon: CalendarCheck },
  { to: '/leaderboard', key: 'leaderboard', icon: Trophy },
  { to: '/settings', key: 'profile', icon: UserRound },
] as const

/** Extra path prefixes that belong to a tab (e.g. the exercise library lives under the Workouts tab). */
const ALSO_ACTIVE: Partial<Record<(typeof tabs)[number]['key'], string[]>> = {
  workouts: ['/exercises'],
  profile: ['/admin'],
}

export function BottomNav() {
  const { t } = useTranslation('common')
  const { pathname } = useLocation()
  const pending = usePendingCount()
  const pendingCount = pending.data ?? 0

  return (
    <nav
      aria-label={t('nav.label')}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/90 backdrop-blur pb-safe',
        'lg:static lg:h-dvh lg:w-56 lg:border-r lg:border-t-0 lg:pb-0',
      )}
    >
      <ul className="mx-auto flex h-16 max-w-md items-stretch justify-around lg:h-full lg:max-w-none lg:flex-col lg:justify-start lg:gap-1 lg:p-3">
        {tabs.map(({ to, key, icon: Icon }) => (
          <li key={key} className={cn('flex-1 lg:flex-none', key === 'profile' && 'lg:mt-auto')}>
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'touch-target flex h-full flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium transition-colors',
                  'lg:h-11 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-lg lg:px-3 lg:text-sm',
                  isActive || ALSO_ACTIVE[key]?.some((p) => pathname.startsWith(p))
                    ? 'text-volt'
                    : 'text-ink-muted hover:text-ink',
                )
              }
            >
              <span className="relative">
                <Icon className="size-6 lg:size-5" aria-hidden />
                {key === 'profile' && pendingCount > 0 && (
                  <span
                    className="absolute -right-1.5 -top-1 flex min-w-4 items-center justify-center rounded-full bg-volt px-1 text-[9px] font-bold leading-4 text-volt-ink ring-2 ring-bg"
                    aria-label={t('nav.pendingBadge', { n: pendingCount })}
                  >
                    {pendingCount}
                  </span>
                )}
              </span>
              <span>{t(`nav.${key}`)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
