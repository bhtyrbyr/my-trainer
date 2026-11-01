import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { StreakFlame } from '@/features/gamification/StreakFlame'
import { levelProgress } from '@/features/gamification/level'

/**
 * Level and streak as one quiet status line above the hero (they used to be a second hero). Opens the
 * ranking, where points matter.
 */
export function ScoreLine({ points, streak, base = '' }: { points: number; streak: number; base?: string }) {
  const { t, i18n } = useTranslation('common')
  const { level, toNext, ratio } = levelProgress(points)
  const nf = new Intl.NumberFormat(i18n.resolvedLanguage === 'en' ? 'en' : 'tr')
  return (
    <Link
      to={base ? `${base}/leaderboard` : '/social/ranking'}
      aria-label={t('score.summary', { points, streak })}
      className="flex min-h-11 items-center gap-4 px-1"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2 text-[13px]">
          <span className="font-semibold text-ink">{t('level', { n: level })}</span>
          <span className="tabular truncate text-ink-muted">
            {nf.format(points)} {t('score.points')} · {t('score.toNextLevel', { n: toNext })}
          </span>
        </span>
        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-raised" aria-hidden>
          <span className="block h-full rounded-full bg-volt" style={{ width: `${ratio * 100}%` }} />
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 border-l border-line pl-4">
        <StreakFlame days={streak} size={20} />
        <span className="display tabular text-[20px] leading-none">{streak}</span>
      </span>
    </Link>
  )
}
