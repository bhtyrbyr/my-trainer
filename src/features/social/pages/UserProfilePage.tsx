import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Flag, Lock, MoreHorizontal, ShieldOff, UserX } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { GroupedList, ListRow } from '@/components/ui/GroupedList'
import { Sheet } from '@/components/ui/Sheet'
import { useAuth } from '@/features/auth/AuthProvider'
import { BadgeMedal } from '@/features/badges/components/BadgeMedal'
import { useUserBadges } from '@/features/badges/hooks'
import { BADGES, isBadgeCode, type BadgeCode } from '@/features/badges/logic'
import { cn } from '@/lib/utils'
import * as api from '../api'
import { compactCount, followAction, followLabel } from '../logic'
import { usePostLayout, useSocialAction, useSocialEnabled, useSocialProfile, useUserPosts } from '../hooks'
import type { SocialProfile } from '../schema'
import { Avatar } from '../components/Avatar'
import { BackLink, EmptyState, LayoutToggle, ListSkeleton, PostList, RowButton } from '../components/parts'
import { ReportSheet } from '../components/ReportSheet'

type FallbackPerson = { display_name: string; username: string; avatar_path: string | null; level: number }

/**
 * /social/u/:id. Point of view: a person, then their work. Header (avatar, names, level, bio), one stat
 * strip (posts / followers / following), one follow action, badges, then posts or a private-account notice.
 */
export function UserProfilePage() {
  const { id = '' } = useParams()
  const { t } = useTranslation(['social', 'common'])
  const enabled = useSocialEnabled()
  const profile = useSocialProfile(id)
  const p = profile.data
  const person = (useLocation().state as { person?: FallbackPerson } | null)?.person

  return (
    <PageShell
      title={p?.display_name ?? person?.display_name ?? t('social:title')}
      leading={<BackLink title={p ? `@${p.username}` : (person?.display_name ?? '')} />}
      actions={p && p.relation !== 'self' ? <ProfileMenu profile={p} /> : undefined}
    >
      <div className="mx-auto max-w-xl pb-6">
        {profile.isLoading ? (
          <ListSkeleton tall />
        ) : profile.error ? (
          <ErrorNote error={profile.error} />
        ) : p ? (
          <ProfileBody p={p} />
        ) : (
          <Unavailable id={id} person={person} viewerEnabled={enabled} />
        )}
      </div>
    </PageShell>
  )
}

function ProfileBody({ p }: { p: SocialProfile }) {
  const { t, i18n } = useTranslation(['social', 'common', 'badges'])
  const lang = i18n.resolvedLanguage === 'en' ? 'en' : 'tr'
  const posts = useUserPosts(p.user_id!, p.can_view === true)
  // get_user_badges (dated); social_profile.badges covers people hidden from the leaderboard
  // get_user_badges, plus social_profile.badges for people hidden from the leaderboard
  const badges = useUserBadges(p.user_id)
  const earned = earnedCodes([...(badges.data ?? []).map((b) => b.badge_code), ...(p.badges ?? [])])
  const respond = useSocialAction((accept: boolean) => api.respondFollow(p.user_id!, accept))
  const self = p.relation === 'self'
  const layout = usePostLayout()

  return (
    <div className="space-y-6">
      <header className="rise-in">
        <div className="flex items-center gap-4">
          <Avatar path={p.avatar_path} size={84} />
          <div className="min-w-0 flex-1">
            <h2 className="display truncate text-[28px]">{p.display_name}</h2>
            <p className="mt-0.5 truncate text-[14px] text-ink-muted">
              @{p.username} · {t('common:level', { n: p.level ?? 1 })}
            </p>
            {p.is_private && (
              <p className="mt-1 inline-flex items-center gap-1 text-[12px] text-ink-faint">
                <Lock className="size-3" aria-hidden />
                {t('social:profile.privateShort')}
              </p>
            )}
          </div>
        </div>
        {p.bio && <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed">{p.bio}</p>}

        <div className="hairline mt-5 grid grid-cols-3 overflow-hidden rounded-[var(--radius-card)] bg-surface">
          <Stat
            value={compactCount(p.posts_count ?? 0, lang)}
            label={t('social:profile.posts', { count: p.posts_count ?? 0 })}
          />
          <Stat
            value={compactCount(p.followers_count ?? 0, lang)}
            label={t('social:profile.followers', { count: p.followers_count ?? 0 })}
            to={p.can_view ? `/social/u/${p.user_id}/followers` : undefined}
          />
          <Stat
            value={compactCount(p.following_count ?? 0, lang)}
            label={t('social:profile.following')}
            to={p.can_view ? `/social/u/${p.user_id}/following` : undefined}
          />
        </div>

        <div className="mt-4">
          {self ? (
            <Link
              to="/settings/social"
              className="hairline flex h-11 items-center justify-center rounded-[var(--radius-button)] bg-raised text-[15px] font-semibold"
            >
              {t('social:profile.editSocial')}
            </Link>
          ) : (
            <FollowButton p={p} />
          )}
        </div>
      </header>

      {p.incoming_request && (
        <div className="hairline flex items-center gap-3 rounded-[var(--radius-card)] bg-surface py-1 pl-4 pr-2">
          <p className="min-w-0 flex-1 text-[14px] text-ink-muted">{t('social:profile.wantsToFollow')}</p>
          <RowButton tone="primary" disabled={respond.isPending} onClick={() => respond.mutate(true)}>
            {t('social:accept')}
          </RowButton>
          <RowButton disabled={respond.isPending} onClick={() => respond.mutate(false)}>
            {t('social:decline')}
          </RowButton>
        </div>
      )}
      <ErrorNote error={respond.error} />

      {earned.length > 0 && (
        <section aria-labelledby="pp-badges" className="space-y-2">
          <h3 id="pp-badges" className="section-title px-1">
            {t('badges:title')}
          </h3>
          <BadgeRow codes={earned} />
        </section>
      )}

      <section aria-labelledby="pp-posts" className="space-y-1">
        <div className="flex items-center justify-between">
          <h3 id="pp-posts" className="section-title px-1">
            {t('social:posts')}
          </h3>
          {p.can_view && <LayoutToggle />}
        </div>
        {p.can_view ? (
          <PostList
            layout={layout}
            query={posts}
            empty={
              <EmptyState
                icon={Lock}
                title={t(self ? 'social:profile.noPostsSelf' : 'social:profile.noPosts')}
              />
            }
          />
        ) : (
          <EmptyState
            icon={Lock}
            title={t('social:profile.privateTitle')}
            body={t('social:profile.privateBody')}
          />
        )}
      </section>
    </div>
  )
}

function Stat({ value, label, to }: { value: string; label: string; to?: string }) {
  const body = (
    <>
      <span className="display tabular block text-[22px] leading-none">{value}</span>
      <span className="mt-1.5 block truncate text-[12px] text-ink-muted">{label}</span>
    </>
  )
  const cls =
    'min-w-0 px-3 py-3.5 text-center [&:not(:first-child)]:border-l [&:not(:first-child)]:border-line'
  return to ? (
    <Link to={to} className={cn(cls, 'transition-colors hover:bg-raised/50')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export function FollowButton({ p, compact }: { p: SocialProfile; compact?: boolean }) {
  const { t } = useTranslation(['social', 'common'])
  const [confirm, setConfirm] = useState(false)
  const action = followAction(p.relation)
  const label = followLabel(p.relation, p.is_private === true, p.follows_me === true)
  const followM = useSocialAction(() => api.follow(p.user_id!))
  const unfollowM = useSocialAction(
    () => api.unfollow(p.user_id!),
    () => setConfirm(false),
  )
  const pending = followM.isPending || unfollowM.isPending
  if (action === 'none') return null
  const primary = action === 'follow'
  return (
    <>
      <Button
        size={compact ? 'sm' : 'md'}
        variant={primary ? 'primary' : 'secondary'}
        className="w-full"
        disabled={pending}
        onClick={() =>
          action === 'follow'
            ? followM.mutate(undefined)
            : action === 'cancel'
              ? unfollowM.mutate(undefined)
              : setConfirm(true)
        }
      >
        {t(`social:follow.${label}`)}
      </Button>
      <ErrorNote error={followM.error ?? (confirm ? null : unfollowM.error)} className="mt-2" />
      <ConfirmSheet
        open={confirm}
        title={t('social:follow.unfollowTitle', { name: p.display_name })}
        body={p.is_private ? t('social:follow.unfollowPrivate') : undefined}
        confirmLabel={t('social:follow.unfollow')}
        tone="danger"
        pending={unfollowM.isPending}
        error={unfollowM.error}
        onConfirm={() => unfollowM.mutate(undefined)}
        onCancel={() => setConfirm(false)}
      />
    </>
  )
}

/** Block / report menu for another user. */
function ProfileMenu({ profile: p }: { profile: SocialProfile }) {
  const { t } = useTranslation(['social', 'common'])
  const navigate = useNavigate()
  const [sheet, setSheet] = useState<null | 'menu' | 'block' | 'report'>(null)
  const blockM = useSocialAction(
    () => api.block(p.user_id!),
    () => navigate('/social', { replace: true }),
  )
  return (
    <>
      <button
        type="button"
        aria-label={t('social:menu')}
        onClick={() => setSheet('menu')}
        className="-mr-2 flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </button>
      {createPortal(
        <>
          <Sheet
            open={sheet === 'menu'}
            label={t('social:menu')}
            closeLabel={t('common:cancel')}
            onClose={() => setSheet(null)}
          >
            <div className="space-y-4 pb-5">
              <GroupedList inset>
                <ListRow
                  icon={Flag}
                  label={t('social:report.title.user')}
                  onClick={() => setSheet('report')}
                  chevron={false}
                />
                <ListRow
                  icon={UserX}
                  label={t('social:block.action')}
                  destructive
                  onClick={() => setSheet('block')}
                  chevron={false}
                />
              </GroupedList>
              <Button size="lg" variant="ghost" className="w-full" onClick={() => setSheet(null)}>
                {t('common:cancel')}
              </Button>
            </div>
          </Sheet>
          <ConfirmSheet
            open={sheet === 'block'}
            title={t('social:block.title', { name: p.display_name })}
            body={t('social:block.body')}
            confirmLabel={t('social:block.action')}
            tone="danger"
            pending={blockM.isPending}
            error={blockM.error}
            onConfirm={() => blockM.mutate(undefined)}
            onCancel={() => setSheet(null)}
          />
          <ReportSheet
            open={sheet === 'report'}
            onClose={() => setSheet(null)}
            kind="user"
            targetId={p.user_id!}
          />
        </>,
        document.body,
      )}
    </>
  )
}

/** No social profile: the viewer has not joined, the person has not, or one of them blocked the other. */
function Unavailable({
  id,
  person,
  viewerEnabled,
}: {
  id: string
  person?: FallbackPerson
  viewerEnabled: boolean
}) {
  const { t } = useTranslation(['social', 'common', 'badges'])
  const { user } = useAuth()
  const badges = useUserBadges(person ? id : null)
  const earned = earnedCodes((badges.data ?? []).map((b) => b.badge_code))
  return (
    <div className="space-y-6">
      {person && (
        <header className="flex items-center gap-4">
          <Avatar path={person.avatar_path} size={72} />
          <div className="min-w-0">
            <h2 className="display truncate text-[26px]">{person.display_name}</h2>
            <p className="truncate text-[14px] text-ink-muted">
              @{person.username} · {t('common:level', { n: person.level })}
            </p>
          </div>
        </header>
      )}
      {person && earned.length > 0 && <BadgeRow codes={earned} />}
      <EmptyState
        icon={ShieldOff}
        title={t(
          viewerEnabled || id === user?.id
            ? 'social:profile.unavailableTitle'
            : 'social:profile.joinToSeeTitle',
        )}
        body={t(viewerEnabled ? 'social:profile.unavailableBody' : 'social:profile.joinToSeeBody')}
        action={
          !viewerEnabled ? (
            <Link
              to="/social"
              className="inner-glow flex h-11 items-center rounded-[var(--radius-button)] bg-volt px-5 text-[15px] font-semibold text-volt-ink"
            >
              {t('social:intro.join')}
            </Link>
          ) : undefined
        }
      />
    </div>
  )
}

/** Earned codes in catalog order, without duplicates or unknown codes. */
function earnedCodes(codes: string[]): BadgeCode[] {
  const set = new Set(codes.filter(isBadgeCode))
  return BADGES.map((b) => b.code).filter((c) => set.has(c))
}

/** Earned badges only, no dates (other people's dates and progress are theirs). */
function BadgeRow({ codes }: { codes: BadgeCode[] }) {
  const { t } = useTranslation('badges')
  return (
    <ul className="grid grid-cols-4 gap-x-1 gap-y-4">
      {codes.slice(0, 8).map((code) => (
        <li key={code} className="flex flex-col items-center text-center">
          <BadgeMedal code={code} earned size={44} />
          <span className="mt-2 line-clamp-2 text-[12px] font-medium leading-tight">
            {t(`items.${code}.name`)}
          </span>
        </li>
      ))}
    </ul>
  )
}
