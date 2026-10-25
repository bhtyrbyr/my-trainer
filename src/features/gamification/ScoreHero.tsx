import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { StreakFlame } from './StreakFlame'
import { daysToNextTier, streakTier, tierProgress, type StreakTier } from './streak'

const POINTS_PER_LEVEL = 1000
const TIER_ORDER: StreakTier[] = ['none', 'low', 'medium', 'high', 'legendary', 'mythic']

/**
 * Point of view: a scoreboard, not a form header. One surface split in two mirrored halves:
 * eyebrow / 40px number / progress bar / one-line caption. Numbers are the imagery.
 */
export function ScoreHero({ points, streak }: { points: number; streak: number }) {
  const { t } = useTranslation('common')
  const level = Math.floor(points / POINTS_PER_LEVEL) + 1
  const intoLevel = points % POINTS_PER_LEVEL
  const tier = streakTier(streak)
  const toNextTier = daysToNextTier(streak)
  const nextTier = TIER_ORDER[TIER_ORDER.indexOf(tier) + 1]

  const streakCaption =
    tier === 'none' ? (
      t('score.startStreak')
    ) : (
      <>
        <span className={cn('font-semibold', tierText[tier])}>{t(`score.tier.${tier}`)}</span>
        <span className="text-ink-faint"> · </span>
        {toNextTier !== null && nextTier
          ? t('score.toNextTier', { n: toNextTier, tier: t(`score.tier.${nextTier}`) })
          : t('score.topTier')}
      </>
    )

  return (
    <section
      aria-label={t('score.summary', { points, streak })}
      className="hairline grid grid-cols-2 overflow-hidden rounded-[var(--radius-card)] bg-surface"
    >
      <Half
        eyebrow={t('score.points')}
        figure={<span className="display tabular text-[40px] leading-none text-ink">{points.toLocaleString()}</span>}
        progress={intoLevel / POINTS_PER_LEVEL}
        barClass="bg-volt"
        caption={
          <>
            <span className="font-semibold text-ink">{t('level', { n: level })}</span>
            <span className="text-ink-faint"> · </span>
            {t('score.toNextLevel', { n: POINTS_PER_LEVEL - intoLevel })}
          </>
        }
      />
      <Half
        className="border-l border-line"
        eyebrow={t('score.streak')}
        figure={
          <span className="flex items-center gap-2">
            <StreakFlame days={streak} size={tier === 'none' ? 24 : 30} />
            <span className="display tabular text-[40px] leading-none text-ink">{streak}</span>
          </span>
        }
        progress={tierProgress(streak)}
        barClass={tier === 'none' ? 'bg-ink-faint' : tierBar[tier]}
        caption={streakCaption}
      />
    </section>
  )
}

function Half({
  eyebrow,
  figure,
  progress,
  barClass,
  caption,
  className,
}: {
  eyebrow: string
  figure: React.ReactNode
  progress: number
  barClass: string
  caption: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 flex-col p-4', className)}>
      <p className="eyebrow">{eyebrow}</p>
      <div className="mt-3 flex h-10 items-center">{figure}</div>
      <div
        className="mt-4 h-1.5 overflow-hidden rounded-full bg-raised"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div className={cn('h-full rounded-full transition-[width] duration-500', barClass)} style={{ width: `${Math.max(progress, 0) * 100}%` }} />
      </div>
      <p className="mt-2 truncate text-[12px] text-ink-muted">{caption}</p>
    </div>
  )
}

const tierText: Record<Exclude<StreakTier, 'none'>, string> = {
  low: 'text-amber-400',
  medium: 'text-orange-400',
  high: 'text-orange-500',
  legendary: 'text-indigo-300',
  mythic: 'mythic-text',
}

const tierBar: Record<Exclude<StreakTier, 'none'>, string> = {
  low: 'bg-amber-400',
  medium: 'bg-orange-400',
  high: 'bg-gradient-to-r from-orange-500 to-red-600',
  legendary: 'bg-gradient-to-r from-indigo-300 to-violet-600',
  mythic: 'bg-gradient-to-r from-amber-300 via-pink-400 to-violet-400',
}
