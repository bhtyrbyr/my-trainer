import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarCheck, Dumbbell, LayoutDashboard, LineChart, Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Five tabs max (thumb reach on iPhone). Settings lives behind the avatar/gear in page headers. */
const tabs = [
  { to: '/', key: 'home', icon: LayoutDashboard },
  { to: '/workouts', key: 'workouts', icon: Dumbbell },
  { to: '/track', key: 'track', icon: LineChart },
  { to: '/today', key: 'today', icon: CalendarCheck },
  { to: '/leaderboard', key: 'leaderboard', icon: Trophy },
] as const

export function BottomNav() {
  const { t } = useTranslation('common')
  return (
    <nav
      aria-label={t('nav.label')}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/90 backdrop-blur pb-safe',
        'lg:static lg:h-dvh lg:w-56 lg:border-r lg:border-t-0 lg:pb-0',
      )}
    >
      <ul className="mx-auto flex h-16 max-w-md items-stretch justify-around lg:h-auto lg:max-w-none lg:flex-col lg:gap-1 lg:p-3">
        {tabs.map(({ to, key, icon: Icon }) => (
          <li key={key} className="flex-1 lg:flex-none">
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'touch-target flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors',
                  'lg:h-11 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-lg lg:px-3 lg:text-sm',
                  isActive ? 'text-volt' : 'text-ink-muted hover:text-ink',
                )
              }
            >
              <Icon className="size-6 lg:size-5" aria-hidden />
              <span>{t(`nav.${key}`)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
