import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { streakTier, type StreakTier } from './streak'
import { StreakFlame } from './StreakFlame'

/**
 * Avatar framed by the streak tier, the same visual language as StreakFlame:
 *  none      -> plain avatar
 *  low       -> thin amber ring
 *  medium    -> orange gradient ring
 *  high      -> fiery conic ring with glow
 *  legendary -> slowly rotating violet-blue ring with glow
 *  mythic    -> rotating gold/pink/violet ring, breathing aura
 * Every framed avatar carries a bottom-right badge: tier flame + streak count. `badge={false}` hides it.
 */
type Frame = { width: number; background: string; spin?: boolean; glow?: string }

const FRAMES: Record<Exclude<StreakTier, 'none'>, Frame> = {
  low: { width: 2, background: '#F59E0B' },
  medium: { width: 2.5, background: 'linear-gradient(135deg, #FDBA74, #EA580C)' },
  high: {
    width: 3,
    background: 'conic-gradient(from 200deg, #FDE68A, #F97316, #DC2626, #F97316, #FDE68A)',
    glow: '0 0 10px rgb(249 115 22 / 0.55)',
  },
  legendary: {
    width: 3,
    background: 'conic-gradient(#E0F2FE, #818CF8, #9333EA, #818CF8, #E0F2FE)',
    spin: true,
    glow: '0 0 12px rgb(129 140 248 / 0.6)',
  },
  mythic: {
    width: 3.5,
    background: 'conic-gradient(#FBBF24, #F472B6, #A78BFA, #F472B6, #FBBF24)',
    spin: true,
    glow: '0 0 16px rgb(236 72 153 / 0.65)',
  },
}

const BADGE_TEXT: Record<Exclude<StreakTier, 'none'>, string> = {
  low: 'text-amber-300',
  medium: 'text-orange-300',
  high: 'text-orange-400',
  legendary: 'text-indigo-200',
  mythic: 'mythic-text',
}

/** Pill pinned to the avatar's bottom-right: flame + streak days, scaled to the avatar. */
function StreakBadge({ streak, tier, avatarSize }: { streak: number; tier: Exclude<StreakTier, 'none'>; avatarSize: number }) {
  const h = Math.max(16, Math.round(avatarSize * 0.34))
  const font = Math.max(10, Math.round(h * 0.62))
  return (
    <span
      className="absolute -bottom-1 -right-2 flex items-center gap-0.5 rounded-full border border-line-strong bg-bg pl-1 pr-1.5 shadow-[0_2px_6px_rgb(0_0_0/0.5)]"
      style={{ height: h }}
    >
      <StreakFlame days={streak} size={Math.round(h * 0.78)} />
      <span className={cn('tabular font-bold leading-none', BADGE_TEXT[tier])} style={{ fontSize: font }}>
        {streak}
      </span>
    </span>
  )
}

type Props = {
  src: string | null
  streak: number
  size: number
  badge?: boolean
  className?: string
}

export function StreakAvatar({ src, streak, size, badge = true, className }: Props) {
  const tier = streakTier(streak)
  const img = src ? (
    <img src={src} alt="" className="size-full rounded-full object-cover" />
  ) : (
    <span className="block size-full rounded-full bg-raised" />
  )

  if (tier === 'none') {
    return (
      <span className={cn('relative inline-block shrink-0', className)} style={{ width: size, height: size }}>
        {img}
      </span>
    )
  }

  const f = FRAMES[tier]
  const gap = Math.max(1.5, f.width * 0.6) // dark gap between ring and photo
  return (
    <span className={cn('relative inline-block shrink-0', className)} style={{ width: size, height: size }}>
      {tier === 'mythic' && (
        <span
          aria-hidden
          className="flame-aura absolute -inset-2 rounded-full"
          style={{ background: 'radial-gradient(circle, rgb(236 72 153 / 0.35), rgb(139 92 246 / 0.18) 55%, transparent 72%)' }}
        />
      )}
      <span
        aria-hidden
        className={cn('absolute inset-0 rounded-full', f.spin && 'ring-spin', tier === 'mythic' && 'ring-spin-fast')}
        style={{ background: f.background, boxShadow: f.glow } as CSSProperties}
      />
      <span
        className="absolute rounded-full bg-bg"
        style={{ inset: f.width, padding: gap }}
      >
        {img}
      </span>
      {badge && <StreakBadge streak={streak} tier={tier} avatarSize={size} />}
    </span>
  )
}
