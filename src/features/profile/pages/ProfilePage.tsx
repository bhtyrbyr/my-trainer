import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronRight, Newspaper, Pencil, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { GroupedList, ListRow } from '@/components/ui/GroupedList'
import { useAuth } from '@/features/auth/AuthProvider'
import { useErrorReports, usePendingCount } from '@/features/admin/hooks'
import { BadgeShelf } from '@/features/badges'
import { StreakAvatar } from '@/features/gamification/StreakAvatar'
import { StreakFlame } from '@/features/gamification/StreakFlame'
import { effectiveStreak } from '@/features/gamification/streak'
import { useLeaderboard } from '@/features/leaderboard/hooks'
import { useSocialEnabled, useSocialProfile } from '@/features/social/hooks'
import { avatarUrl } from '../api'

/**
 * Profile hub (tab root). Point of view: an identity card, not a settings dump. The person first
 * (96 px avatar, name, level, streak), one action (edit), the numbers that link to the ranking, the
 * badge shelf, and only then the doors to Settings and, for admins, the admin hub.
 */
export function ProfilePage() {
  const { t, i18n } = useTranslation(['profile', 'common', 'social'])
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const pending = usePendingCount()
  const openReports = useErrorReports('open')
  const week = useLeaderboard('week')
  const nf = new Intl.NumberFormat(i18n.resolvedLanguage === 'en' ? 'en' : 'tr')

  const streak = effectiveStreak(profile?.current_streak, profile?.last_active_on)
  const me = (week.data ?? []).find((r) => r.user_id === profile?.user_id)
  const adminCount = (pending.data ?? 0) + (openReports.data?.length ?? 0)
  const socialOn = useSocialEnabled()
  const social = useSocialProfile(profile?.user_id ?? '', socialOn).data

  return (
    <PageShell title={t('profile:title')} bare className="pt-6">
      <div className="mx-auto max-w-md space-y-7 pb-6 lg:grid lg:max-w-4xl lg:grid-cols-2 lg:items-start lg:gap-8 lg:space-y-0">
        <div className="space-y-5">
          {profile ? (
            <header className="rise-in flex flex-col items-center text-center lg:items-start lg:text-left">
              <StreakAvatar src={avatarUrl(profile.avatar_path, profile.updated_at)} streak={streak} size={96} />
              <h2 className="display mt-4 max-w-full truncate text-[30px]">{profile.display_name}</h2>
              <p className="mt-1 max-w-full truncate text-[15px] text-ink-muted">@{profile.username}</p>
              <p className="tabular mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[13px] text-ink-muted lg:justify-start">
                <span className="font-medium text-ink">{t('common:level', { n: profile.level })}</span>
                <span className="text-ink-faint" aria-hidden>·</span>
                <span>{t('profile:pointsTotal', { n: nf.format(profile.total_points) })}</span>
                <span className="text-ink-faint" aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <StreakFlame days={streak} size={16} />
                  {t('profile:streak', { count: streak })}
                </span>
              </p>
            </header>
          ) : (
            <HeroSkeleton />
          )}

          <Link
            to="/me/edit"
            className="hairline flex h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-button)] bg-raised text-[15px] font-semibold text-ink transition-colors hover:bg-raised/70"
          >
            <Pencil className="size-4" aria-hidden />
            {t('profile:edit')}
          </Link>

          <Link
            to="/social?tab=ranking"
            aria-label={t('profile:stats.open')}
            className="hairline group grid grid-cols-[1fr_1fr_1fr_auto] items-stretch overflow-hidden rounded-[var(--radius-card)] bg-surface transition-colors hover:bg-raised/40"
          >
            <Stat label={t('profile:stats.rank')} value={me ? `#${me.rank}` : '–'} loading={week.isLoading} />
            <Stat label={t('profile:stats.week')} value={me ? nf.format(me.points) : '0'} loading={week.isLoading} divider />
            <Stat label={t('profile:stats.best')} value={profile ? nf.format(Math.max(profile.longest_streak, streak)) : '–'} loading={!profile} divider />
            <span className="flex items-center pr-3 text-ink-faint group-hover:text-ink" aria-hidden>
              <ChevronRight className="size-4" />
            </span>
          </Link>
        </div>

        <div className="space-y-7">
          <BadgeShelf />

          <GroupedList>
            {socialOn && profile && (
              <ListRow
                icon={Newspaper}
                label={t('social:me.posts')}
                hint={
                  social ? (
                    <span className="tabular">
                      {t('social:me.counts', { posts: social.posts_count ?? 0, followers: social.followers_count ?? 0, following: social.following_count ?? 0 })}
                    </span>
                  ) : undefined
                }
                to={`/social/u/${profile.user_id}`}
              />
            )}
            <ListRow icon={SlidersHorizontal} label={t('profile:rows.settings')} to="/settings" />
            {isAdmin && (
              <ListRow
                icon={ShieldCheck}
                label={t('profile:rows.admin')}
                to="/admin"
                badge={adminCount}
                aria-label={adminCount > 0 ? t('profile:rows.adminBadge', { count: adminCount }) : undefined}
              />
            )}
          </GroupedList>
        </div>
      </div>
    </PageShell>
  )
}

function Stat({ label, value, loading, divider }: { label: string; value: string; loading?: boolean; divider?: boolean }) {
  return (
    <div className={divider ? 'min-w-0 border-l border-line px-3 py-4' : 'min-w-0 py-4 pl-4 pr-3'}>
      {loading ? (
        <span className="block h-7 w-12 animate-pulse rounded bg-raised motion-reduce:animate-none" />
      ) : (
        <p className="display tabular text-[26px] leading-none">{value}</p>
      )}
      <p className="mt-2 text-[12px] leading-tight text-ink-muted">{label}</p>
    </div>
  )
}

function HeroSkeleton() {
  return (
    <div className="flex flex-col items-center lg:items-start" aria-busy="true">
      <span className="size-24 animate-pulse rounded-full bg-raised motion-reduce:animate-none" />
      <span className="mt-4 h-8 w-44 animate-pulse rounded-lg bg-raised motion-reduce:animate-none" />
      <span className="mt-2 h-4 w-28 animate-pulse rounded bg-raised motion-reduce:animate-none" />
      <span className="mt-3 h-4 w-52 animate-pulse rounded bg-raised motion-reduce:animate-none" />
    </div>
  )
}
