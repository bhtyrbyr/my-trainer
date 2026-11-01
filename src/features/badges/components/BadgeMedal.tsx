import {
  CalendarCheck,
  CalendarDays,
  Camera,
  Droplets,
  Dumbbell,
  Flame,
  FlameKindling,
  HeartPulse,
  Layers,
  ListChecks,
  Moon,
  Scale,
  Sunrise,
  Trophy,
  Weight,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { BADGES, type BadgeCode, type BadgeMetric } from '../logic'

const FAMILY_ICONS: Record<BadgeMetric, LucideIcon> = {
  workouts: Dumbbell,
  streak: Flame,
  sets: Layers,
  volume_kg: Weight,
  prs: Trophy,
  cardio_minutes: HeartPulse,
  early_workouts: Sunrise,
  weekend_workouts: CalendarDays,
  habit_days: CalendarCheck,
  todos: ListChecks,
  water_goal_days: Droplets,
  sleep_logs: Moon,
  weigh_ins: Scale,
  photos: Camera,
}
const METRIC_OF = new Map<BadgeCode, BadgeMetric>(BADGES.map((b) => [b.code, b.metric]))
/** One icon per family; the long streaks get the bigger fire. */
const iconFor = (code: BadgeCode): LucideIcon =>
  code === 'streak_30' || code === 'streak_100' || code === 'streak_365' ? FlameKindling : FAMILY_ICONS[METRIC_OF.get(code) ?? 'workouts']

type Props = {
  code: BadgeCode
  earned: boolean
  /** 0..1 progress drawn as a thin ring around a locked medal; omit for none */
  ratio?: number | null
  size?: number
  className?: string
}

/**
 * Earned: a solid volt disc with the inner highlight (the accent means "achieved").
 * Locked: a quiet raised disc, faint icon, and a hairline ring that fills with progress.
 */
export function BadgeMedal({ code, earned, ratio, size = 56, className }: Props) {
  const Icon = iconFor(code)
  const stroke = Math.max(2, Math.round(size / 24))
  const r = size / 2 - stroke / 2
  const c = 2 * Math.PI * r
  const showRing = !earned && ratio != null
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full',
        earned ? 'inner-glow bg-volt text-volt-ink' : 'bg-raised text-ink-faint',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Icon style={{ width: size * 0.42, height: size * 0.42 }} strokeWidth={earned ? 2.25 : 1.75} />
      {showRing && (
        <svg
          className="absolute inset-0 -rotate-90"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--color-line-strong)"
            strokeWidth={stroke}
          />
          {ratio > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="var(--color-ink-muted)"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${c * Math.min(1, ratio)} ${c}`}
            />
          )}
        </svg>
      )}
    </span>
  )
}
