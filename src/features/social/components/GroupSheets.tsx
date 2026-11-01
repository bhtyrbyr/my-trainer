import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Check, Copy, Loader2, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { GroupedList, ListRow, Segmented } from '@/components/ui/GroupedList'
import { Sheet } from '@/components/ui/Sheet'
import { useAuth } from '@/features/auth/AuthProvider'
import * as api from '../api'
import { inviteLink } from '../logic'
import { useFollowers, useGroupMembers, useSocialAction } from '../hooks'
import { groupFormSchema, type GroupForm } from '../schema'
import { PersonRow, RowButton } from './parts'

const inputCls =
  'hairline mt-1.5 w-full rounded-[var(--radius-input)] bg-bg px-3 text-[16px] outline-none focus:border-volt'

/** Name, description, open/closed; shared by create and group settings. */
export function GroupFields({ value, onChange }: { value: GroupForm; onChange: (v: GroupForm) => void }) {
  const { t } = useTranslation('social')
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="section-title">{t('groups.form.name')}</span>
        <input
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          maxLength={60}
          className={`${inputCls} h-11`}
        />
      </label>
      <label className="block">
        <span className="section-title">{t('groups.form.description')}</span>
        <textarea
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          maxLength={300}
          rows={3}
          className={`${inputCls} resize-none py-2.5`}
        />
      </label>
      <div>
        <Segmented
          label={t('groups.form.visibility')}
          value={value.visibility}
          onChange={(v) => onChange({ ...value, visibility: v })}
          options={[
            { value: 'open', label: t('groups.open') },
            { value: 'closed', label: t('groups.closed') },
          ]}
        />
        <p className="mt-2 px-1 text-[12px] leading-snug text-ink-faint">
          {t(`groups.form.${value.visibility}Hint`)}
        </p>
      </div>
    </div>
  )
}

export function GroupCreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['social', 'common'])
  const navigate = useNavigate()
  const [form, setForm] = useState<GroupForm>({ name: '', description: '', visibility: 'open' })
  const create = useSocialAction(
    (f: GroupForm) => api.createGroup(f.name.trim(), f.description.trim(), f.visibility),
    (id) => {
      onClose()
      navigate(`/social/g/${id}`)
    },
  )
  const valid = groupFormSchema.safeParse(form).success
  return (
    <Sheet open={open} label={t('social:groups.create')} closeLabel={t('common:cancel')} onClose={onClose}>
      <div className="pb-5">
        <h2 className="display text-[24px]">{t('social:groups.create')}</h2>
        <div className="mt-5">
          <GroupFields value={form} onChange={setForm} />
        </div>
        <ErrorNote error={create.error} className="mt-4" />
        <div className="mt-6 grid gap-2">
          <Button size="lg" disabled={!valid || create.isPending} onClick={() => create.mutate(form)}>
            {create.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
            {t('social:groups.createAction')}
          </Button>
          <Button size="lg" variant="ghost" onClick={onClose}>
            {t('common:cancel')}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

/** Invite: the code/link (Web Share API, copy fallback) and the caller's followers with an Invite button. */
export function InviteSheet({
  open,
  onClose,
  groupId,
  code,
  groupName,
}: {
  open: boolean
  onClose: () => void
  groupId: string
  code: string | null
  groupName: string
}) {
  const { t } = useTranslation(['social', 'common'])
  const { user } = useAuth()
  const followers = useFollowers(user?.id ?? '', open && Boolean(user))
  const members = useGroupMembers(groupId, open)
  const [copied, setCopied] = useState(false)
  const [invited, setInvited] = useState<Set<string>>(new Set())
  const invite = useSocialAction(
    (uid: string) => api.inviteToGroup(groupId, uid),
    (_r, uid) => setInvited((s) => new Set(s).add(uid)),
  )
  const link = code ? inviteLink(window.location.origin, code) : ''
  const known = new Map((members.data ?? []).map((m) => [m.user_id, m.status]))

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: groupName,
          text: t('social:groups.inviteText', { name: groupName }),
          url: link,
        })
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
      }
    }
    await navigator.clipboard?.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  const copy = async () => {
    await navigator.clipboard?.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Sheet open={open} label={t('social:groups.invite')} closeLabel={t('common:cancel')} onClose={onClose}>
      <div className="space-y-6 pb-5">
        <h2 className="display text-[24px]">{t('social:groups.invite')}</h2>
        {code && (
          <div>
            <p className="eyebrow">{t('social:groups.code')}</p>
            <p className="display tabular mt-1 select-all text-[30px] tracking-[0.08em]">{code}</p>
            <p className="mt-1 break-all text-[12px] text-ink-faint">{link}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button onClick={() => void share()}>
                <Share2 className="size-4" aria-hidden />
                {t('social:groups.shareLink')}
              </Button>
              <Button variant="secondary" onClick={() => void copy()}>
                {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copied ? t('social:copied') : t('social:copy')}
              </Button>
            </div>
          </div>
        )}
        <GroupedList
          title={t('social:groups.inviteFollowers')}
          footer={followers.data?.length === 0 ? t('social:groups.noFollowers') : undefined}
        >
          {followers.isLoading && <div className="h-14 animate-pulse bg-surface" />}
          {(followers.data ?? []).map((p) => {
            const status = invited.has(p.user_id!) ? 'invited' : known.get(p.user_id)
            return (
              <PersonRow
                key={p.user_id}
                userId={p.user_id}
                name={p.display_name}
                username={p.username}
                avatarPath={p.avatar_path}
                trailing={
                  status ? (
                    <span className="px-2 text-[13px] text-ink-faint">
                      {t(`social:groups.status.${status}`)}
                    </span>
                  ) : (
                    <RowButton
                      tone="primary"
                      disabled={invite.isPending}
                      onClick={() => invite.mutate(p.user_id!)}
                    >
                      {t('social:groups.inviteAction')}
                    </RowButton>
                  )
                }
              />
            )
          })}
        </GroupedList>
        <ErrorNote error={invite.error} />
        <Button size="lg" variant="ghost" className="w-full" onClick={onClose}>
          {t('social:done')}
        </Button>
      </div>
    </Sheet>
  )
}

/** Owner/admin actions on one member. */
export function MemberSheet({
  open,
  onClose,
  groupId,
  member,
  myRole,
}: {
  open: boolean
  onClose: () => void
  groupId: string
  member: { user_id: string; display_name: string | null; role: string | null } | null
  myRole: string | null
}) {
  const { t } = useTranslation(['social', 'common'])
  const setRole = useSocialAction(
    (r: 'owner' | 'admin' | 'member') => api.setGroupRole(groupId, member!.user_id, r),
    onClose,
  )
  const remove = useSocialAction(() => api.removeGroupMember(groupId, member!.user_id), onClose)
  const isOwner = myRole === 'owner'
  const canRemove = member && member.role !== 'owner' && (isOwner || member.role === 'member')
  return (
    <Sheet
      open={open && member !== null}
      label={member?.display_name ?? ''}
      closeLabel={t('common:cancel')}
      onClose={onClose}
    >
      <div className="space-y-5 pb-5">
        <h2 className="display truncate text-[24px]">{member?.display_name}</h2>
        <GroupedList>
          {isOwner && member?.role === 'member' && (
            <ListRow
              label={t('social:groups.makeAdmin')}
              onClick={() => setRole.mutate('admin')}
              chevron={false}
            />
          )}
          {isOwner && member?.role === 'admin' && (
            <ListRow
              label={t('social:groups.makeMember')}
              onClick={() => setRole.mutate('member')}
              chevron={false}
            />
          )}
          {isOwner && member?.role !== 'owner' && (
            <ListRow
              label={t('social:groups.makeOwner')}
              hint={t('social:groups.makeOwnerHint')}
              onClick={() => setRole.mutate('owner')}
              chevron={false}
            />
          )}
          {canRemove && (
            <ListRow
              label={t('social:groups.remove')}
              destructive
              onClick={() => remove.mutate(undefined)}
              chevron={false}
            />
          )}
        </GroupedList>
        <ErrorNote error={setRole.error ?? remove.error} />
        <Button size="lg" variant="ghost" className="w-full" onClick={onClose}>
          {t('common:cancel')}
        </Button>
      </div>
    </Sheet>
  )
}
