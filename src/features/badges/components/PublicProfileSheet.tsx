import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { Sheet } from '@/components/ui/Sheet'
import { StreakAvatar } from '@/features/gamification/StreakAvatar'
import { avatarUrl } from '@/features/profile/api'
import { useUserBadges } from '../hooks'
import { BADGES, shelfItems } from '../logic'
import { BadgeGrid } from './BadgeShelf'

export type PublicPerson = {
  user_id: string
  display_name: string
  username: string
  avatar_path: string | null
  level: number
  streak: number
}

/**
 * What other people may see: the leaderboard's public columns plus earned badges (get_user_badges).
 * No progress for locked badges: other users' totals are private.
 */
export function PublicProfileSheet({
  person,
  onClose,
}: {
  person: PublicPerson | null
  onClose: () => void
}) {
  const { t } = useTranslation(['badges', 'common'])
  const badges = useUserBadges(person?.user_id ?? null)
  const items = shelfItems(badges.data ?? [])
  const earned = items.filter((i) => i.earnedAt).length

  return (
    <Sheet
      open={person !== null}
      label={person?.display_name ?? ''}
      closeLabel={t('badges:close')}
      onClose={onClose}
    >
      {person && (
        <div className="pb-5">
          <div className="flex items-center gap-4">
            <StreakAvatar src={avatarUrl(person.avatar_path)} streak={person.streak} size={72} />
            <div className="min-w-0">
              <h2 className="display truncate text-[26px]">{person.display_name}</h2>
              <p className="truncate text-[13px] text-ink-muted">
                @{person.username} · {t('common:level', { n: person.level })}
              </p>
              {person.streak > 0 && (
                <p className="tabular mt-0.5 text-[12px] text-ink-faint">
                  {t('common:streakDays', { n: person.streak })}
                </p>
              )}
            </div>
          </div>

          <div className="mt-7 flex items-baseline justify-between">
            <h3 className="eyebrow">{t('badges:title')}</h3>
            {badges.data && (
              <span className="tabular text-[12px] text-ink-faint">
                {t('badges:count', { earned, total: BADGES.length })}
              </span>
            )}
          </div>
          <ErrorNote error={badges.error} className="mt-3" />
          <div className="mt-3">
            {badges.isLoading ? (
              <div
                className="h-[196px] animate-pulse rounded-[var(--radius-input)] bg-raised/50 motion-reduce:animate-none"
                aria-busy="true"
              />
            ) : (
              <BadgeGrid items={items} size={48} />
            )}
          </div>
          {badges.data && earned === 0 && (
            <p className="mt-4 text-center text-[13px] text-ink-faint">{t('badges:public.none')}</p>
          )}

          <Button variant="secondary" size="lg" className="mt-7 w-full" onClick={onClose}>
            {t('badges:close')}
          </Button>
        </div>
      )}
    </Sheet>
  )
}
