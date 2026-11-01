import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'
import { Flag, Lock, LogOut, MoreHorizontal, Settings2, UserPlus, Users } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { GroupedList, ListRow } from '@/components/ui/GroupedList'
import { SectionTabs } from '@/components/ui/SectionTabs'
import { Sheet } from '@/components/ui/Sheet'
import { useAuth } from '@/features/auth/AuthProvider'
import * as api from '../api'
import { useGroup, useGroupBans, useGroupMembers, useGroupPosts, useSocialAction } from '../hooks'
import type { GroupInfo, GroupMember } from '../schema'
import {
  BackLink,
  EmptyState,
  ListSkeleton,
  PersonRow,
  PostList,
  RowButton,
  ShareFab,
} from '../components/parts'
import { InviteSheet, MemberSheet } from '../components/GroupSheets'
import { ReportSheet } from '../components/ReportSheet'
import { ComposerSheet } from '../components/shareBridge'

/**
 * /social/g/:id. Header (name, open/closed, members, description), one membership action, then
 * Posts | Members. Closed groups show only the name to non-members (the RPC enforces it).
 */
export function GroupPage() {
  const { id = '' } = useParams()
  const { t } = useTranslation(['social', 'common'])
  const group = useGroup(id)
  const g = group.data

  return (
    <PageShell
      title={g?.name ?? t('social:groups.title')}
      leading={<BackLink fallback="/social/search?s=groups" title={t('social:groups.title')} />}
      actions={g ? <GroupMenu g={g} /> : undefined}
    >
      <div className="mx-auto max-w-xl pb-6">
        {group.isLoading ? (
          <ListSkeleton tall />
        ) : group.error ? (
          <ErrorNote error={group.error} />
        ) : g ? (
          <GroupBody g={g} />
        ) : (
          <EmptyState icon={Lock} title={t('social:groups.goneTitle')} body={t('social:groups.goneBody')} />
        )}
      </div>
    </PageShell>
  )
}

const GROUP_VIEWS = ['posts', 'members'] as const

function GroupBody({ g }: { g: GroupInfo }) {
  const { t } = useTranslation(['social', 'common'])
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'members' && g.can_view_posts ? 'members' : 'posts'
  const posts = useGroupPosts(g.group_id!, g.can_view_posts === true && view === 'posts')
  const [composer, setComposer] = useState(false)
  const join = useSocialAction(() => api.joinGroup(g.group_id!))
  const respond = useSocialAction((accept: boolean) => api.respondGroup(g.group_id!, accept))
  const cancel = useSocialAction(() => api.leaveGroup(g.group_id!))
  const active = g.my_status === 'active'

  return (
    <div className="space-y-6">
      <header className="rise-in">
        <p className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
          {g.visibility === 'closed' ? (
            <Lock className="size-3.5" aria-hidden />
          ) : (
            <Users className="size-3.5" aria-hidden />
          )}
          {t(`social:groups.${g.visibility === 'closed' ? 'closed' : 'open'}`)}
          {g.member_count != null && (
            <>
              <span aria-hidden>·</span>
              <span className="tabular">{t('social:groups.members', { count: g.member_count })}</span>
            </>
          )}
          {g.my_role && g.my_role !== 'member' && (
            <>
              <span aria-hidden>·</span>
              {t(`social:groups.role.${g.my_role}`)}
            </>
          )}
        </p>
        <h2 className="display mt-2 text-[30px]">{g.name}</h2>
        {g.description && (
          <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-ink-muted">
            {g.description}
          </p>
        )}

        <div className="mt-5">
          {g.my_status === 'invited' ? (
            <div className="grid grid-cols-2 gap-2">
              <Button disabled={respond.isPending} onClick={() => respond.mutate(true)}>
                {t('social:accept')}
              </Button>
              <Button variant="secondary" disabled={respond.isPending} onClick={() => respond.mutate(false)}>
                {t('social:decline')}
              </Button>
            </div>
          ) : g.my_status === 'pending' ? (
            <Button
              variant="secondary"
              className="w-full"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(undefined)}
            >
              {t('social:groups.cancelRequest')}
            </Button>
          ) : !active ? (
            <Button className="w-full" disabled={join.isPending} onClick={() => join.mutate(undefined)}>
              {t(g.visibility === 'closed' ? 'social:groups.requestJoin' : 'social:groups.join')}
            </Button>
          ) : null}
          {g.my_status === 'pending' && (
            <p className="mt-2 text-center text-[13px] text-ink-faint">{t('social:groups.pendingNote')}</p>
          )}
          <ErrorNote error={join.error ?? respond.error ?? cancel.error} className="mt-3" />
        </div>
      </header>

      {g.can_view_posts ? (
        <>
          <SectionTabs
            label={t('social:groups.sections')}
            options={GROUP_VIEWS}
            value={view}
            onChange={(v) => setParams(v === 'posts' ? {} : { view: v }, { replace: true })}
            labelOf={(v) => (v === 'posts' ? t('social:posts') : t('social:groups.membersTab'))}
          />
          {view === 'posts' ? (
            <div className={active ? 'pb-20' : undefined}>
              <PostList
                query={posts}
                empty={<EmptyState icon={Users} title={t('social:groups.noPosts')} />}
              />
            </div>
          ) : (
            <Members g={g} />
          )}
        </>
      ) : (
        <EmptyState icon={Lock} title={t('social:groups.closedTitle')} body={t('social:groups.closedBody')} />
      )}

      {active && view === 'posts' && (
        <>
          <ShareFab onClick={() => setComposer(true)} />
          <ComposerSheet open={composer} onClose={() => setComposer(false)} groupId={g.group_id} />
        </>
      )}
    </div>
  )
}

function Members({ g }: { g: GroupInfo }) {
  const { t } = useTranslation('social')
  const { user } = useAuth()
  // the member list is for active members only (the RPC returns nothing to anyone else)
  const isMember = g.my_status === 'active'
  const members = useGroupMembers(g.group_id!, isMember)
  const [selected, setSelected] = useState<GroupMember | null>(null)
  const respond = useSocialAction((a: { user: string; accept: boolean }) =>
    api.respondGroup(g.group_id!, a.accept, a.user),
  )
  const manager = g.my_role === 'owner' || g.my_role === 'admin'
  const all = members.data ?? []
  const requests = all.filter((m) => m.status === 'pending')
  const invited = all.filter((m) => m.status === 'invited')
  const active = all.filter((m) => m.status === 'active')
  const canManage = (m: GroupMember) =>
    manager && m.user_id !== user?.id && m.role !== 'owner' && (g.my_role === 'owner' || m.role === 'member')

  if (!isMember)
    return (
      <p className="py-8 text-center text-[14px] text-ink-muted">
        {t('groups.membersOnly', { count: g.member_count ?? 0 })}
      </p>
    )
  if (members.isLoading) return <ListSkeleton rows={4} />
  return (
    <div className="space-y-6">
      <ErrorNote error={members.error ?? respond.error} />
      {manager && requests.length > 0 && (
        <GroupedList title={t('groups.requests')}>
          {requests.map((m) => (
            <PersonRow
              key={m.user_id}
              userId={m.user_id}
              name={m.display_name}
              username={m.username}
              avatarPath={m.avatar_path}
              trailing={
                <>
                  <RowButton
                    tone="primary"
                    disabled={respond.isPending}
                    onClick={() => respond.mutate({ user: m.user_id!, accept: true })}
                  >
                    {t('approve')}
                  </RowButton>
                  <RowButton
                    disabled={respond.isPending}
                    onClick={() => respond.mutate({ user: m.user_id!, accept: false })}
                  >
                    {t('decline')}
                  </RowButton>
                </>
              }
            />
          ))}
        </GroupedList>
      )}
      <GroupedList title={t('groups.members', { count: active.length })}>
        {active.map((m) => (
          <PersonRow
            key={m.user_id}
            userId={m.user_id}
            name={m.display_name}
            username={m.username}
            avatarPath={m.avatar_path}
            hint={m.role !== 'member' ? t(`groups.role.${m.role}`) : undefined}
            trailing={
              canManage(m) ? (
                <button
                  type="button"
                  aria-label={t('groups.manage', { name: m.display_name })}
                  onClick={() => setSelected(m)}
                  className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised"
                >
                  <MoreHorizontal className="size-5" aria-hidden />
                </button>
              ) : undefined
            }
          />
        ))}
      </GroupedList>
      {manager && invited.length > 0 && (
        <GroupedList title={t('groups.invitedList')}>
          {invited.map((m) => (
            <PersonRow
              key={m.user_id}
              userId={m.user_id}
              name={m.display_name}
              username={m.username}
              avatarPath={m.avatar_path}
              hint={t('groups.status.invited')}
            />
          ))}
        </GroupedList>
      )}
      <MemberSheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        groupId={g.group_id!}
        member={
          selected
            ? { user_id: selected.user_id!, display_name: selected.display_name, role: selected.role }
            : null
        }
        myRole={g.my_role}
      />
      {manager && <Bans groupId={g.group_id!} />}
    </div>
  )
}

/** Removed members stay banned (no rejoin by code or request) until an owner/admin lifts it. */
function Bans({ groupId }: { groupId: string }) {
  const { t } = useTranslation('social')
  const bans = useGroupBans(groupId, true)
  const unban = useSocialAction((user: string) => api.unbanGroupMember(groupId, user))
  if (!bans.data?.length) return null
  return (
    <>
      <ErrorNote error={unban.error} />
      <GroupedList title={t('groups.bans')} footer={t('groups.bansHint')}>
        {bans.data.map((b) => (
          <PersonRow
            key={b.user_id}
            userId={b.user_id}
            name={b.display_name}
            username={b.username}
            avatarPath={b.avatar_path}
            trailing={
              <RowButton disabled={unban.isPending} onClick={() => unban.mutate(b.user_id)}>
                {t('groups.unban')}
              </RowButton>
            }
          />
        ))}
      </GroupedList>
    </>
  )
}

function GroupMenu({ g }: { g: GroupInfo }) {
  const { t } = useTranslation(['social', 'common'])
  const [sheet, setSheet] = useState<null | 'menu' | 'invite' | 'leave' | 'report'>(null)
  const leave = useSocialAction(
    () => api.leaveGroup(g.group_id!),
    () => setSheet(null),
  )
  const manager = g.my_role === 'owner' || g.my_role === 'admin'
  const active = g.my_status === 'active'
  return (
    <>
      {active && manager && (
        <button
          type="button"
          aria-label={t('social:groups.invite')}
          onClick={() => setSheet('invite')}
          className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
        >
          <UserPlus className="size-5" aria-hidden />
        </button>
      )}
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
                {active && manager && (
                  <ListRow
                    icon={UserPlus}
                    label={t('social:groups.invite')}
                    onClick={() => setSheet('invite')}
                  />
                )}
                {active && manager && (
                  <ListRow
                    icon={Settings2}
                    label={t('social:groups.settings')}
                    to={`/social/g/${g.group_id}/settings`}
                  />
                )}
                <ListRow
                  icon={Flag}
                  label={t('social:report.title.group')}
                  onClick={() => setSheet('report')}
                  chevron={false}
                />
                {active && (
                  <ListRow
                    icon={LogOut}
                    label={t('social:groups.leave')}
                    destructive
                    onClick={() => setSheet('leave')}
                    chevron={false}
                  />
                )}
              </GroupedList>
              <Button size="lg" variant="ghost" className="w-full" onClick={() => setSheet(null)}>
                {t('common:cancel')}
              </Button>
            </div>
          </Sheet>
          <InviteSheet
            open={sheet === 'invite'}
            onClose={() => setSheet(null)}
            groupId={g.group_id!}
            code={g.invite_code}
            groupName={g.name ?? ''}
          />
          <ConfirmSheet
            open={sheet === 'leave'}
            title={t('social:groups.leaveTitle', { name: g.name })}
            body={t(g.my_role === 'owner' ? 'social:groups.leaveOwnerBody' : 'social:groups.leaveBody')}
            confirmLabel={t('social:groups.leave')}
            tone="danger"
            pending={leave.isPending}
            error={leave.error}
            onConfirm={() => leave.mutate(undefined)}
            onCancel={() => setSheet(null)}
          />
          <ReportSheet
            open={sheet === 'report'}
            onClose={() => setSheet(null)}
            kind="group"
            targetId={g.group_id!}
          />
        </>,
        document.body,
      )}
    </>
  )
}
