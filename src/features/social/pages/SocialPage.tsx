import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Compass, Lock, Plus, Search, Users } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { GroupedList, ListRow, Segmented } from '@/components/ui/GroupedList'
import { LeaderboardContent } from '@/features/leaderboard/pages/LeaderboardPage'
import { cn } from '@/lib/utils'
import { useFeed, useMyGroups, useSearchGroups, useSearchUsers, useSocialAction, useSocialMe } from '../hooks'
import * as api from '../api'
import { JoinIntro } from '../components/JoinIntro'
import {
  BellButton,
  EmptyState,
  ListSkeleton,
  PersonRow,
  PostList,
  RowButton,
  ShareFab,
} from '../components/parts'
import { ComposerSheet } from '../components/shareBridge'
import { GroupCreateSheet } from '../components/GroupSheets'

type Tab = 'feed' | 'groups' | 'ranking'
const TABS: Tab[] = ['feed', 'groups', 'ranking']

/**
 * Community tab (/social). Point of view: the posts are the page. Chrome is one title, the bell, and one
 * segmented control; the feed has a quieter second switch (Following / Discover) and one floating volt
 * action. The Ranking segment works without joining.
 */
export function SocialPage() {
  const { t } = useTranslation(['social', 'common'])
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const raw = params.get('tab') as Tab | null
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'feed'
  const me = useSocialMe()
  const enabled = me.data?.enabled === true

  return (
    <PageShell title={t('social:title')} actions={enabled ? <BellButton /> : undefined}>
      <div className="mx-auto max-w-xl">
        <Segmented
          label={t('social:sections')}
          value={tab}
          onChange={(v) => setParams(v === 'feed' ? {} : { tab: v }, { replace: true })}
          options={TABS.map((v) => ({ value: v, label: t(`social:tabs.${v}`) }))}
          className="mb-5"
        />
        {tab === 'ranking' ? (
          <LeaderboardContent
            onOpenPerson={
              enabled ? (row) => navigate(`/social/u/${row.user_id}`, { state: { person: row } }) : undefined
            }
          />
        ) : me.isLoading ? (
          <ListSkeleton tall />
        ) : me.error ? (
          <ErrorNote error={me.error} />
        ) : !enabled ? (
          <JoinIntro paused={me.data?.enabled === false && me.data.enabled_at != null} />
        ) : tab === 'feed' ? (
          <FeedView />
        ) : (
          <GroupsView />
        )}
      </div>
    </PageShell>
  )
}

function FeedView() {
  const { t } = useTranslation('social')
  const [params, setParams] = useSearchParams()
  const mode = params.get('feed') === 'discover' ? 'discover' : 'following'
  const feed = useFeed(mode)
  const [composer, setComposer] = useState(false)

  return (
    <>
      <div role="tablist" aria-label={t('feed.label')} className="-mt-1 mb-4 flex gap-5 px-1">
        {(['following', 'discover'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setParams(m === 'following' ? {} : { feed: m }, { replace: true })}
            className={cn(
              'relative h-11 text-[15px] font-semibold transition-colors',
              mode === m ? 'text-ink' : 'text-ink-faint hover:text-ink-muted',
            )}
          >
            {t(`feed.${m}`)}
            <span
              className={cn(
                'absolute inset-x-0 bottom-1.5 h-0.5 rounded-full bg-volt transition-opacity',
                mode !== m && 'opacity-0',
              )}
            />
          </button>
        ))}
      </div>

      {mode === 'discover' && <PeopleSearch />}

      <div className="pb-20">
        <PostList
          query={feed}
          empty={
            mode === 'following' ? (
              <EmptyState
                icon={Users}
                title={t('feed.emptyTitle')}
                body={t('feed.emptyBody')}
                action={
                  <RowButton
                    tone="secondary"
                    onClick={() => setParams({ feed: 'discover' }, { replace: true })}
                  >
                    {t('feed.goDiscover')}
                  </RowButton>
                }
              />
            ) : (
              <EmptyState
                icon={Compass}
                title={t('feed.discoverEmptyTitle')}
                body={t('feed.discoverEmptyBody')}
              />
            )
          }
        />
      </div>

      <ShareFab onClick={() => setComposer(true)} />
      <ComposerSheet open={composer} onClose={() => setComposer(false)} />
    </>
  )
}

function SearchField({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (v: string) => void
  label: string
}) {
  return (
    <label className="hairline flex h-11 items-center gap-2 rounded-[var(--radius-input)] bg-surface px-3 focus-within:border-volt">
      <Search className="size-4 shrink-0 text-ink-faint" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={label}
        maxLength={60}
        className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-faint"
      />
    </label>
  )
}

function PeopleSearch() {
  const { t } = useTranslation('social')
  const [q, setQ] = useState('')
  const query = q.trim()
  const hits = useSearchUsers(query)
  return (
    <div className="mb-5 space-y-3">
      <SearchField value={q} onChange={setQ} label={t('search.people')} />
      {query.length >= 2 && (
        <GroupedList footer={hits.data?.length === 0 ? t('search.none') : undefined}>
          {hits.isLoading ? (
            <div className="h-14 animate-pulse bg-surface" />
          ) : (
            (hits.data ?? []).map((h) => (
              <PersonRow
                key={h.user_id}
                userId={h.user_id}
                name={h.display_name}
                username={h.username}
                avatarPath={h.avatar_path}
                hint={
                  h.relation && h.relation !== 'none'
                    ? t(`follow.${h.relation}`)
                    : h.is_private
                      ? t('profile.privateShort')
                      : undefined
                }
              />
            ))
          )}
        </GroupedList>
      )}
    </div>
  )
}

function GroupsView() {
  const { t } = useTranslation('social')
  const [q, setQ] = useState('')
  const query = q.trim()
  const mine = useMyGroups()
  const hits = useSearchGroups(query)
  const [creating, setCreating] = useState(false)
  const respond = useSocialAction((a: { id: string; accept: boolean }) => api.respondGroup(a.id, a.accept))

  const groups = mine.data ?? []
  const invited = groups.filter((g) => g.status === 'invited')
  const active = groups.filter((g) => g.status === 'active')
  const pending = groups.filter((g) => g.status === 'pending')

  return (
    <div className="space-y-7 pb-6">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <SearchField value={q} onChange={setQ} label={t('groups.search')} />
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          aria-label={t('groups.create')}
          className="inner-glow flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-input)] bg-volt text-volt-ink"
        >
          <Plus className="size-5" strokeWidth={2.5} aria-hidden />
        </button>
      </div>

      {query.length >= 2 ? (
        <GroupedList
          title={t('groups.results')}
          footer={hits.data?.length === 0 ? t('search.none') : undefined}
        >
          {(hits.data ?? []).map((g) => (
            <ListRow
              key={g.group_id}
              icon={g.visibility === 'closed' ? Lock : Users}
              label={g.name}
              hint={
                g.member_count != null ? t('groups.members', { count: g.member_count }) : t('groups.closed')
              }
              value={g.my_status ? t(`groups.status.${g.my_status}`) : undefined}
              to={`/social/g/${g.group_id}`}
            />
          ))}
          {hits.isLoading && <div className="h-14 animate-pulse bg-surface" />}
        </GroupedList>
      ) : mine.isLoading ? (
        <ListSkeleton />
      ) : (
        <>
          <ErrorNote error={mine.error ?? respond.error} />
          {invited.length > 0 && (
            <GroupedList title={t('groups.invitations')}>
              {invited.map((g) => (
                <div key={g.group_id} className="px-4 pb-2 pt-3">
                  <Link to={`/social/g/${g.group_id}`} className="block">
                    <span className="block truncate text-[15px] text-ink">{g.name}</span>
                    <span className="block text-[12px] text-ink-faint">
                      {t('groups.members', { count: g.member_count ?? 0 })}
                    </span>
                  </Link>
                  <div className="-ml-0.5 mt-1 flex">
                    <RowButton
                      tone="primary"
                      disabled={respond.isPending}
                      onClick={() => respond.mutate({ id: g.group_id!, accept: true })}
                    >
                      {t('accept')}
                    </RowButton>
                    <RowButton
                      disabled={respond.isPending}
                      onClick={() => respond.mutate({ id: g.group_id!, accept: false })}
                    >
                      {t('decline')}
                    </RowButton>
                  </div>
                </div>
              ))}
            </GroupedList>
          )}
          {active.length === 0 && invited.length === 0 && pending.length === 0 ? (
            <EmptyState
              icon={Users}
              title={t('groups.emptyTitle')}
              body={t('groups.emptyBody')}
              action={
                <RowButton tone="primary" onClick={() => setCreating(true)}>
                  {t('groups.create')}
                </RowButton>
              }
            />
          ) : (
            active.length > 0 && (
              <GroupedList title={t('groups.mine')}>
                {active.map((g) => (
                  <ListRow
                    key={g.group_id}
                    icon={g.visibility === 'closed' ? Lock : Users}
                    label={g.name}
                    hint={t('groups.members', { count: g.member_count ?? 0 })}
                    value={g.role !== 'member' ? t(`groups.role.${g.role}`) : undefined}
                    to={`/social/g/${g.group_id}`}
                  />
                ))}
              </GroupedList>
            )
          )}
          {pending.length > 0 && (
            <GroupedList title={t('groups.requested')}>
              {pending.map((g) => (
                <ListRow
                  key={g.group_id}
                  icon={Lock}
                  label={g.name}
                  value={t('groups.status.pending')}
                  to={`/social/g/${g.group_id}`}
                />
              ))}
            </GroupedList>
          )}
        </>
      )}

      <GroupCreateSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}
