import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { KeyRound, Lock, Plus, Search, Users, X } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { GroupedList, ListRow } from '@/components/ui/GroupedList'
import * as api from '../api'
import { normalizeTag } from '../hashtags'
import {
  useMyGroups,
  useSearchGroups,
  useSearchTags,
  useSearchUsers,
  useSocialAction,
  useSocialMe,
} from '../hooks'
import { GroupCreateSheet } from '../components/GroupSheets'
import { JoinIntro } from '../components/JoinIntro'
import { BackLink, PersonRow, RowButton } from '../components/parts'
import { SectionTabs } from '@/components/ui/SectionTabs'

type Segment = 'people' | 'groups' | 'tags'
const SEGMENTS: readonly Segment[] = ['people', 'groups', 'tags']

/** The typed value once it has been still for `ms` (one RPC per pause, not per keystroke). */
function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

/**
 * /social/search: one field, three segments (People | Groups | Tags, `?s=`). A leading `#` switches to
 * Tags. The settled query is mirrored to `?q=` so coming back from a result restores it.
 */
export function SearchPage() {
  const { t } = useTranslation('social')
  const [params, setParams] = useSearchParams()
  const me = useSocialMe()
  const raw = params.get('s') as Segment | null
  const segment: Segment = raw && SEGMENTS.includes(raw) ? raw : 'people'
  const [q, setQ] = useState(() => params.get('q') ?? '')
  const query = useDebounced(q.trim())
  const input = useRef<HTMLInputElement>(null)

  const setSegment = (s: Segment) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (s === 'people') next.delete('s')
        else next.set('s', s)
        return next
      },
      { replace: true },
    )

  useEffect(() => {
    if ((params.get('q') ?? '') === query) return
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (query) next.set('q', query)
        else next.delete('q')
        return next
      },
      { replace: true },
    )
  }, [query, params, setParams])

  const enabled = me.data?.enabled === true
  useEffect(() => {
    if (enabled) input.current?.focus()
  }, [enabled])

  const onType = (v: string) => {
    setQ(v)
    if (v.trimStart().startsWith('#') && segment !== 'tags') setSegment('tags')
  }

  return (
    <PageShell title={t('search.title')} leading={<BackLink title={t('search.title')} />}>
      <div className="mx-auto max-w-xl pb-6">
        {me.isLoading ? (
          <GroupedList>
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </GroupedList>
        ) : me.error ? (
          <ErrorNote error={me.error} />
        ) : !enabled ? (
          <JoinIntro paused={me.data?.enabled === false && me.data.enabled_at != null} />
        ) : (
          <>
            <label className="hairline flex h-12 items-center gap-2.5 rounded-[var(--radius-input)] bg-surface pl-3.5 transition-colors focus-within:border-volt">
              <Search className="size-[18px] shrink-0 text-ink-faint" aria-hidden />
              <input
                ref={input}
                type="search"
                value={q}
                onChange={(e) => onType(e.target.value)}
                placeholder={t(`search.${segment}`)}
                aria-label={t(`search.${segment}`)}
                maxLength={60}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="search"
                className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden"
              />
              {q && (
                <button
                  type="button"
                  aria-label={t('search.clear')}
                  onClick={() => {
                    setQ('')
                    input.current?.focus()
                  }}
                  className="flex size-11 shrink-0 items-center justify-center text-ink-faint hover:text-ink"
                >
                  <X className="size-[18px]" aria-hidden />
                </button>
              )}
            </label>
            <SectionTabs
              className="mb-4 mt-2"
              label={t('search.segments')}
              options={SEGMENTS}
              value={segment}
              onChange={setSegment}
              labelOf={(v) => t(`search.kinds.${v}`)}
            />
            <div role="tabpanel" aria-label={t(`search.kinds.${segment}`)}>
              {segment === 'people' ? (
                <PeopleResults query={query} />
              ) : segment === 'groups' ? (
                <GroupResults query={query} />
              ) : (
                <TagResults query={query} />
              )}
            </div>
          </>
        )}
      </div>
    </PageShell>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="max-w-[36ch] px-1 pt-1 text-[14px] leading-relaxed text-ink-muted">{children}</p>
}

/** Placeholder row for the flat lists: an icon dot and two text lines on the page, no box. */
const RowSkeleton = () => (
  <div className="flex h-14 items-center gap-3 px-4 motion-safe:animate-pulse" aria-busy="true">
    <span className="size-8 shrink-0 rounded-full bg-raised" />
    <span className="flex-1 space-y-1.5">
      <span className="block h-3 w-2/5 rounded-full bg-raised" />
      <span className="block h-2.5 w-1/4 rounded-full bg-raised/70" />
    </span>
  </div>
)

function PeopleResults({ query }: { query: string }) {
  const { t } = useTranslation('social')
  const hits = useSearchUsers(query)
  if (query.length < 2) return <Hint>{t('search.peopleHint')}</Hint>
  return (
    <>
      <ErrorNote error={hits.error} className="mb-3" />
      <GroupedList footer={hits.data?.length === 0 ? t('search.none') : undefined}>
        {hits.isLoading ? (
          <RowSkeleton />
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
    </>
  )
}

/** Results while typing; with an empty field: quick actions, then my invitations, groups and requests. */
function GroupResults({ query }: { query: string }) {
  const { t } = useTranslation('social')
  const mine = useMyGroups()
  const hits = useSearchGroups(query)
  const [creating, setCreating] = useState(false)
  const respond = useSocialAction((a: { id: string; accept: boolean }) => api.respondGroup(a.id, a.accept))

  const groups = mine.data ?? []
  const invited = groups.filter((g) => g.status === 'invited')
  const active = groups.filter((g) => g.status === 'active')
  const pending = groups.filter((g) => g.status === 'pending')
  const none = !mine.isLoading && groups.length === 0

  if (query.length >= 2)
    return (
      <>
        <ErrorNote error={hits.error} className="mb-3" />
        <GroupedList footer={hits.data?.length === 0 ? t('search.none') : undefined}>
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
          {hits.isLoading && <RowSkeleton />}
        </GroupedList>
      </>
    )

  return (
    <div className="space-y-7">
      <GroupedList footer={none ? t('groups.emptyBody') : undefined}>
        <ListRow icon={Plus} label={t('rail.create')} onClick={() => setCreating(true)} />
        <ListRow icon={KeyRound} label={t('rail.joinByCode')} to="/social/join" />
      </GroupedList>

      {mine.isLoading ? (
        <GroupedList>
          <RowSkeleton />
          <RowSkeleton />
        </GroupedList>
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
          {active.length > 0 && (
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

function TagResults({ query }: { query: string }) {
  const { t } = useTranslation('social')
  const tag = normalizeTag(query.replace(/^#+/, ''))
  const hits = useSearchTags(tag)
  if (tag.length < 2) return <Hint>{t('search.tagsHint')}</Hint>
  return (
    <>
      <ErrorNote error={hits.error} className="mb-3" />
      <GroupedList footer={hits.data?.length === 0 ? t('search.none') : undefined}>
        {hits.isLoading ? (
          <RowSkeleton />
        ) : (
          (hits.data ?? []).map((h) => (
            <ListRow
              key={h.tag}
              label={`#${h.tag}`}
              hint={t('tags.posts', { count: h.post_count })}
              to={`/social/tag/${encodeURIComponent(h.tag)}`}
            />
          ))
        )}
      </GroupedList>
    </>
  )
}
