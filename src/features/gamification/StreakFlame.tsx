import { useId } from 'react'
import { cn } from '@/lib/utils'
import { streakTier, type StreakTier } from './streak'

/**
 * Tiered streak flame. Fire is the one place warm hues are allowed in the palette:
 *  none      -> grey ember outline
 *  low       -> small amber flame
 *  medium    -> full orange flame
 *  high      -> orange-red flame with a soft glow
 *  legendary -> violet-blue "spirit" flame with a gentle flicker
 */
const STOPS: Record<Exclude<StreakTier, 'none'>, [string, string, string]> = {
  low: ['#FFE7A3', '#FBBF24', '#F59E0B'],
  medium: ['#FFE08A', '#FB923C', '#EA580C'],
  high: ['#FFF1B8', '#F97316', '#DC2626'],
  legendary: ['#E0F2FE', '#818CF8', '#9333EA'],
}

const SIZE: Record<StreakTier, number> = { none: 18, low: 18, medium: 20, high: 22, legendary: 24 }

const OUTER = 'M12 2.5c.6 3.2 2.6 4.9 4.3 6.8 1.6 1.8 2.9 3.8 2.9 6.4A7.2 7.2 0 0 1 12 22.5a7.2 7.2 0 0 1-7.2-6.8c0-2.4 1-4.2 2.4-5.7.2 1.6.9 2.8 2.1 3.4-.4-4.1 1.1-7.9 2.7-10.9Z'
const INNER = 'M12 12.2c.4 1.6 1.4 2.5 2.2 3.4.7.8 1.2 1.6 1.2 2.7a3.4 3.4 0 0 1-6.8 0c0-1.2.5-2.1 1.2-2.9.1.8.5 1.3 1 1.6-.2-1.8.4-3.5 1.2-4.8Z'

export function StreakFlame({ days, className }: { days: number; className?: string }) {
  const tier = streakTier(days)
  const gid = useId()
  const size = SIZE[tier]

  if (tier === 'none') {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className={cn('text-ink-faint', className)} aria-hidden>
        <path d={OUTER} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    )
  }

  const [core, mid, edge] = STOPS[tier]
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      className={cn(
        'shrink-0 overflow-visible',
        tier === 'high' && 'drop-shadow-[0_0_6px_rgb(249_115_22/0.55)]',
        tier === 'legendary' && 'flame-flicker drop-shadow-[0_0_8px_rgb(129_140_248/0.7)]',
        className,
      )}
    >
      <defs>
        <linearGradient id={`${gid}-o`} x1="12" y1="22" x2="12" y2="2" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={edge} />
          <stop offset="0.55" stopColor={mid} />
          <stop offset="1" stopColor={mid} stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id={`${gid}-i`} x1="12" y1="22" x2="12" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={core} />
          <stop offset="1" stopColor={mid} />
        </linearGradient>
      </defs>
      <path d={OUTER} fill={`url(#${gid}-o)`} opacity={tier === 'low' ? 0.9 : 1} />
      <path d={INNER} fill={`url(#${gid}-i)`} />
    </svg>
  )
}
