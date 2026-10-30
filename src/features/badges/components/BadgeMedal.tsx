import {
  CalendarCheck,
  Camera,
  Dumbbell,
  Flame,
  FlameKindling,
  Layers,
  ListChecks,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BadgeCode } from '../logic'

const BADGE_ICONS: Record<BadgeCode, LucideIcon> = {
  first_workout: Dumbbell,
  streak_7: Flame,
  streak_30: FlameKindling,
  sets_100: Layers,
  photos_10: Camera,
  habit_30: CalendarCheck,
  todo_50: ListChecks,
}

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
  const Icon = BADGE_ICONS[code]
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
