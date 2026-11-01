import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { AtSign, Flame, Newspaper, Pencil, Settings } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { SectionTabs } from '@/components/ui/SectionTabs'
import { useAuth } from '@/features/auth/AuthProvider'
import { BadgeCollection } from '@/features/badges'
import { StreakAvatar } from '@/features/gamification/StreakAvatar'
import { levelProgress } from '@/features/gamification/level'
import { effectiveStreak } from '@/features/gamification/streak'
import { EmptyState, LayoutToggle, PostList, TimelineSkeleton } from '@/features/social/components/parts'
import { useMentionedPosts, usePostLayout, useSocialMe, useUserPosts } from '@/features/social/hooks'
import type { Profile } from '@/lib/database.types'
import { cn } from '@/lib/utils'
import { avatarUrl } from '../api'

const SECTIONS = ['posts', 'tagged', 'badges'] as const
/** Secondary button look for links (Button is a <button>). */
const SECONDARY_LINK =
  'hairline inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-button)] bg-raised px-4 text-[15px] font-semibold text-ink transition-colors hover:bg-raised/70'
type Section = (typeof SECTIONS)[number]

/**
 * Profile tab (/me). Point of view: a person and their work, nothing else. The header carries only the
 * title and the door to Settings; the identity (streak-framed avatar, names, level meter, best streak,
 * edit) sits on the page, then Posts | Tagged | Badges (`?tab=tagged|badges`; Posts when the tab is
 * opened). Every setting, the admin hub and sign-out live in Settings.
 */
export function ProfilePage({ previewProfile }: { previewProfile?: Profile }) {
  const { t } = useTranslation(['profile', 'common'])
  const auth = useAuth()
  const profile = previewProfile ?? auth.profile
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab')
  const section: Section = SECTIONS.find((s) => s === tab) ?? 'posts'
  const setSection = (s: Section) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (s === 'posts') next.delete('tab')
        else next.set('tab', s)
        next.delete('view') // the list/grid choice belongs to each post section
        return next
      },
      { replace: true },
    )

  return (
    <PageShell
      title={t('profile:title')}
      actions={
        <Link
          to={previewProfile ? 'settings' : '/settings'}
          aria-label={t('profile:settings')}
          className="-mr-2 flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-raised hover:text-ink"
        >
          <Settings className="size-[22px]" aria-hidden />
        </Link>
      }
    >
      <div className="mx-auto max-w-xl pb-6">
        {profile ? <Identity profile={profile} editTo={previewProfile ? 'edit' : '/me/edit'} /> : <IdentitySkeleton />}

        <SectionTabs
          className="mt-7"
          label={t('profile:tabs.label')}
          options={SECTIONS}
          value={section}
          onChange={setSection}
          labelOf={(v) => t(`profile:tabs.${v}`)}
          fit
        />
        <div role="tabpanel" aria-label={t(`profile:tabs.${section}`)}>
          {section === 'posts' ? (
            <MyPosts userId={profile?.user_id ?? ''} />
          ) : section === 'tagged' ? (
            <TaggedPosts />
          ) : (
            <BadgeCollection />
          )}
        </div>
      </div>
    </PageShell>
  )
}

function Identity({ profile, editTo }: { profile: Profile; editTo: string }) {
  const { t, i18n } = useTranslation(['profile', 'common'])
  const nf = new Intl.NumberFormat(i18n.resolvedLanguage === 'en' ? 'en' : 'tr')
  const streak = effectiveStreak(profile.current_streak, profile.last_active_on)
  const { level, into, toNext, ratio } = levelProgress(profile.total_points)
  const best = Math.max(profile.longest_streak, streak)

  return (
    <header className="rise-in">
      <div className="flex items-center gap-4">
        <StreakAvatar src={avatarUrl(profile.avatar_path, profile.updated_at)} streak={streak} size={88} />
        <div className="min-w-0 flex-1">
          <h2 className="display truncate text-[28px]">{profile.display_name}</h2>
          <p className="mt-0.5 truncate text-[14px] text-ink-muted">@{profile.username}</p>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <span className="display text-[20px] leading-none">{t('common:level', { n: level })}</span>
          <span className="tabular text-[13px] text-ink-muted">
            {t('profile:level.points', { n: nf.format(profile.total_points) })}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={t('profile:level.progress', { level: level + 1 })}
          aria-valuemin={0}
          aria-valuemax={1000}
          aria-valuenow={into}
          className="mt-2.5 h-1 overflow-hidden rounded-full bg-raised"
        >
          <div className="h-full rounded-full bg-volt" style={{ width: `${ratio * 100}%` }} />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-3 text-[12px]">
          <p className="tabular text-ink-faint">{t('profile:level.toNext', { n: nf.format(toNext), level: level + 1 })}</p>
          {best > 0 && (
            <p className="tabular flex shrink-0 items-center gap-1 self-center text-ink-muted">
              <Flame className="size-3.5" aria-hidden />
              {t('profile:bestStreak', { count: best, n: nf.format(best) })}
            </p>
          )}
        </div>
      </div>

      <Link to={editTo} className={cn(SECONDARY_LINK, 'mt-5 w-full text-[14px]')}>
        <Pencil className="size-4" aria-hidden />
        {t('profile:edit')}
      </Link>
    </header>
  )
}

/** The way into Community, shown by both post sections while the caller has not joined. */
function NotJoined() {
  const { t } = useTranslation('profile')
  return (
    <EmptyState
      icon={Newspaper}
      title={t('profile:posts.offTitle')}
      body={t('profile:posts.offBody')}
      action={
        <Link to="/social" className={SECONDARY_LINK}>
          {t('profile:posts.join')}
        </Link>
      }
    />
  )
}

/** Own posts (social_user_posts with the caller's id), or the way into Community when not joined. */
function MyPosts({ userId }: { userId: string }) {
  const { t } = useTranslation(['profile', 'social'])
  const me = useSocialMe()
  const joined = me.data?.enabled === true
  const posts = useUserPosts(userId, joined && userId !== '')
  const layout = usePostLayout()

  if (me.isLoading) return <TimelineSkeleton rows={2} />
  if (!joined) return <NotJoined />
  return (
    <>
      <div className="-mt-3 mb-1 flex justify-end">
        <LayoutToggle />
      </div>
      <PostList
        layout={layout}
        query={posts}
        empty={<EmptyState icon={Newspaper} title={t('social:profile.noPostsSelf')} />}
      />
    </>
  )
}

/** Posts the caller is tagged in (social_mentioned_posts), same list/grid as Posts. */
function TaggedPosts() {
  const { t } = useTranslation('profile')
  const me = useSocialMe()
  const joined = me.data?.enabled === true
  const posts = useMentionedPosts(joined)
  const layout = usePostLayout()

  if (me.isLoading) return <TimelineSkeleton rows={2} />
  if (!joined) return <NotJoined />
  return (
    <>
      <div className="-mt-3 mb-1 flex justify-end">
        <LayoutToggle />
      </div>
      <PostList
        layout={layout}
        query={posts}
        empty={<EmptyState icon={AtSign} title={t('profile:tagged.emptyTitle')} body={t('profile:tagged.emptyBody')} />}
      />
    </>
  )
}

function IdentitySkeleton() {
  return (
    <div aria-busy="true">
      <div className="flex items-center gap-4">
        <span className="size-[88px] shrink-0 animate-pulse rounded-full bg-raised motion-reduce:animate-none" />
        <div className="flex-1 space-y-2">
          <span className="block h-7 w-40 animate-pulse rounded-lg bg-raised motion-reduce:animate-none" />
          <span className="block h-4 w-24 animate-pulse rounded bg-raised motion-reduce:animate-none" />
        </div>
      </div>
      <span className="mt-6 block h-1 w-full rounded-full bg-raised" />
      <span className="mt-5 block h-11 w-full animate-pulse rounded-[var(--radius-button)] bg-raised motion-reduce:animate-none" />
    </div>
  )
}
