import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { StreakFlame } from './StreakFlame'
import { streakTier, type StreakTier } from './streak'

/** Points + streak, the only stats in the dashboard header. Number on top, small label below. */
export function ScoreHeader({ points, streak }: { points: number; streak: number }) {
  const { t } = useTranslation('common')
  const tier = streakTier(streak)
  return (
    <div className="flex items-center gap-5">
      <Stat value={points} label={t('score.points')} />
      <span className="h-8 w-px bg-line-strong" aria-hidden />
      <div className="flex items-center gap-2" title={t(`score.tier.${tier}`)}>
        <StreakFlame days={streak} />
        <Stat
          value={streak}
          label={
            <>
              {t('score.streak')}
              {tier !== 'none' && (
                <>
                  <span className="text-ink-faint"> · </span>
                  <span className={tierColor[tier]}>{t(`score.tier.${tier}`)}</span>
                </>
              )}
            </>
          }
        />
      </div>
      <span className="sr-only">{t('score.summary', { points, streak })}</span>
    </div>
  )
}

function Stat({ value, label }: { value: number; label: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="display tabular text-[24px] leading-none text-ink">{value}</span>
      <span className="mt-1 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{label}</span>
    </div>
  )
}

const tierColor: Record<Exclude<StreakTier, 'none'>, string> = {
  low: 'text-amber-400',
  medium: 'text-orange-400',
  high: 'text-orange-500',
  legendary: cn('text-indigo-300'),
}
