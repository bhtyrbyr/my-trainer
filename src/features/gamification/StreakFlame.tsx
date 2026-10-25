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
 *  mythic    -> three-layer white-gold / magenta / violet flame, aura, rising sparks
 */
type Lit = Exclude<StreakTier, 'none' | 'mythic'>
const STOPS: Record<Lit, [string, string, string]> = {
  low: ['#FFE7A3', '#FBBF24', '#F59E0B'],
  medium: ['#FFE08A', '#FB923C', '#EA580C'],
  high: ['#FFF1B8', '#F97316', '#DC2626'],
  legendary: ['#E0F2FE', '#818CF8', '#9333EA'],
}

const SIZE: Record<StreakTier, number> = { none: 18, low: 18, medium: 20, high: 22, legendary: 24, mythic: 28 }

const OUTER = 'M12 2.5c.6 3.2 2.6 4.9 4.3 6.8 1.6 1.8 2.9 3.8 2.9 6.4A7.2 7.2 0 0 1 12 22.5a7.2 7.2 0 0 1-7.2-6.8c0-2.4 1-4.2 2.4-5.7.2 1.6.9 2.8 2.1 3.4-.4-4.1 1.1-7.9 2.7-10.9Z'
const MIDDLE = 'M12 7.2c.5 2.4 1.9 3.7 3.1 5.1 1.1 1.3 2 2.7 2 4.5a5.1 5.1 0 0 1-10.2 0c0-1.7.7-3 1.7-4.1.2 1.1.7 2 1.5 2.4-.3-2.9.8-5.6 1.9-7.9Z'
const INNER = 'M12 12.2c.4 1.6 1.4 2.5 2.2 3.4.7.8 1.2 1.6 1.2 2.7a3.4 3.4 0 0 1-6.8 0c0-1.2.5-2.1 1.2-2.9.1.8.5 1.3 1 1.6-.2-1.8.4-3.5 1.2-4.8Z'

export function StreakFlame({ days, className, size: sizeOverride }: { days: number; className?: string; size?: number }) {
  const tier = streakTier(days)
  const gid = useId()
  const size = sizeOverride ?? SIZE[tier]

  if (tier === 'none') {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className={cn('text-ink-faint', className)} aria-hidden>
        <path d={OUTER} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    )
  }

  if (tier === 'mythic') return <MythicFlame size={size} gid={gid} className={className} compact={sizeOverride !== undefined} />

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

/** The top tier. Built from three nested flames so it reads as "more fire", not just a different colour. */
function MythicFlame({ size, gid, className, compact }: { size: number; gid: string; className?: string; compact?: boolean }) {
  return (
    <span className={cn('relative inline-flex shrink-0', className)} style={{ width: size, height: size }} aria-hidden>
      {/* aura (skipped in compact badges, the avatar frame already carries the aura) */}
      {!compact && (
        <span
          className="flame-aura absolute -inset-2 rounded-full"
          style={{ background: 'radial-gradient(circle at 50% 60%, rgb(236 72 153 / 0.45), rgb(139 92 246 / 0.25) 45%, transparent 70%)' }}
        />
      )}
      <svg viewBox="0 0 24 24" width={size} height={size} className="flame-flicker relative overflow-visible drop-shadow-[0_0_10px_rgb(236_72_153/0.75)]">
        <defs>
          <linearGradient id={`${gid}-mo`} x1="12" y1="23" x2="12" y2="2" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#7C3AED" />
            <stop offset="0.5" stopColor="#C026D3" />
            <stop offset="1" stopColor="#F472B6" />
          </linearGradient>
          <linearGradient id={`${gid}-mm`} x1="12" y1="22" x2="12" y2="7" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#F472B6" />
            <stop offset="1" stopColor="#FBBF24" />
          </linearGradient>
          <linearGradient id={`${gid}-mi`} x1="12" y1="22" x2="12" y2="12" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset="1" stopColor="#FEF3C7" />
          </linearGradient>
        </defs>
        <path d={OUTER} fill={`url(#${gid}-mo)`} />
        <path d={MIDDLE} fill={`url(#${gid}-mm)`} />
        <path d={INNER} fill={`url(#${gid}-mi)`} />
      </svg>
      {/* rising sparks */}
      {!compact && (
        <>
          <span className="flame-spark absolute left-[22%] top-[30%] size-[3px] rounded-full bg-amber-200" style={{ animationDelay: '0s' }} />
          <span className="flame-spark absolute left-[70%] top-[20%] size-[2px] rounded-full bg-pink-300" style={{ animationDelay: '0.6s' }} />
          <span className="flame-spark absolute left-[48%] top-[8%] size-[2px] rounded-full bg-violet-300" style={{ animationDelay: '1.2s' }} />
        </>
      )}
    </span>
  )
}
