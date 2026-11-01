import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Bell, Compass, Lock, LogOut, Newspaper, PauseCircle, Trash2, Users } from 'lucide-react'
import { BackTitle } from '@/components/layout/BackTitle'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { GroupedList, ListRow } from '@/components/ui/GroupedList'
import { Switch } from '@/components/ui/Switch'
import { useAuth } from '@/features/auth/AuthProvider'
import { useUserSettings } from '@/features/settings/hooks'
import * as api from '../api'
import { useBlocked, useFollowRequests, useSocialAction, useSocialMe, useSocialProfile } from '../hooks'
import { BIO_MAX, type MySocial } from '../schema'
import { ListSkeleton, PersonRow, RowButton } from '../components/parts'

/**
 * Settings > Privacy & data > Community (/settings/social): account privacy, bio, push, requests,
 * followers, blocked people, and the two ways out (pause, leave and delete).
 */
export function SocialSettingsPage() {
  const { t } = useTranslation(['social', 'settings'])
  const me = useSocialMe()
  return (
    <PageShell
      title={t('social:settings.title')}
      leading={<BackTitle to="/settings" label={t('settings:title')} title={t('social:settings.title')} />}
    >
      <div className="mx-auto max-w-xl pb-6">
        {me.isLoading ? (
          <ListSkeleton rows={4} />
        ) : me.data?.enabled ? (
          <Enabled me={me.data} />
        ) : (
          <GroupedList footer={t('social:settings.offHint')}>
            <ListRow icon={Users} label={t('social:settings.join')} to="/social" />
          </GroupedList>
        )}
        <ErrorNote error={me.error} />
      </div>
    </PageShell>
  )
}

function Enabled({ me }: { me: MySocial }) {
  const { t } = useTranslation(['social', 'common'])
  const navigate = useNavigate()
  const { user } = useAuth()
  const uid = user?.id ?? ''
  const counts = useSocialProfile(uid).data
  const requests = useFollowRequests()
  const blocked = useBlocked()
  const { settings, updateSettings } = useUserSettings()
  const [bio, setBio] = useState(me.bio ?? '')
  const [leave, setLeave] = useState<null | 'pause' | 'delete'>(null)

  const update = useSocialAction((p: { isPrivate?: boolean; discoverable?: boolean; bio?: string }) =>
    api.updateSocialSettings(p),
  )
  const respond = useSocialAction((a: { user: string; accept: boolean }) =>
    api.respondFollow(a.user, a.accept),
  )
  const unblock = useSocialAction((u: string) => api.unblock(u))
  const disable = useSocialAction(
    (del: boolean) => api.disableSocial(del),
    () => navigate('/social', { replace: true }),
  )

  return (
    <div className="space-y-7">
      <GroupedList
        title={t('social:settings.account')}
        footer={t(me.is_private ? 'social:settings.privateOnHint' : 'social:settings.privateOffHint')}
      >
        <ListRow
          icon={Lock}
          label={t('social:settings.private')}
          className="py-1.5 pr-2"
          trailing={
            <Switch
              checked={me.is_private}
              disabled={update.isPending}
              label={t('social:settings.private')}
              onChange={(v) => update.mutate({ isPrivate: v })}
            />
          }
        />
        <ListRow
          icon={Compass}
          label={t('social:settings.discoverable')}
          hint={t('social:settings.discoverableHint')}
          className="py-1.5 pr-2"
          trailing={
            <Switch
              checked={me.discoverable}
              disabled={update.isPending}
              label={t('social:settings.discoverable')}
              onChange={(v) => update.mutate({ discoverable: v })}
            />
          }
        />
      </GroupedList>

      <section className="space-y-2">
        <label htmlFor="social-bio" className="section-title block px-4">
          {t('social:settings.bio')}
        </label>
        <div className="hairline rounded-[var(--radius-card)] bg-surface p-3">
          <textarea
            id="social-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
            rows={3}
            placeholder={t('social:settings.bioPlaceholder')}
            className="w-full resize-none bg-transparent px-1 text-[16px] leading-relaxed outline-none placeholder:text-ink-faint"
          />
          <div className="flex items-center justify-between gap-3 pl-1">
            <span className="tabular text-[12px] text-ink-faint">
              {bio.length}/{BIO_MAX}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={bio === (me.bio ?? '') || update.isPending}
              onClick={() => update.mutate({ bio })}
            >
              {t('social:save')}
            </Button>
          </div>
        </div>
      </section>
      <ErrorNote error={update.error} />

      <GroupedList title={t('social:settings.notifications')}>
        <ListRow
          icon={Bell}
          label={t('social:settings.push')}
          hint={t('social:settings.pushHint')}
          className="py-1.5 pr-2"
          trailing={
            <Switch
              checked={settings?.social_push ?? true}
              disabled={!settings || updateSettings.isPending}
              label={t('social:settings.push')}
              onChange={(v) => updateSettings.mutate({ social_push: v })}
            />
          }
        />
      </GroupedList>

      <GroupedList title={t('social:settings.people')}>
        <ListRow
          icon={Newspaper}
          label={t('social:settings.myPosts')}
          value={counts ? <span className="tabular">{counts.posts_count}</span> : undefined}
          to={`/social/u/${uid}`}
        />
        <ListRow
          icon={Users}
          label={t('social:settings.followers')}
          value={counts ? <span className="tabular">{counts.followers_count}</span> : undefined}
          to={`/social/u/${uid}/followers`}
        />
      </GroupedList>

      {(requests.data?.length ?? 0) > 0 && (
        <GroupedList title={t('social:settings.requests', { count: requests.data!.length })}>
          {requests.data!.map((r) => (
            <PersonRow
              key={r.user_id}
              userId={r.user_id}
              name={r.display_name}
              username={r.username}
              avatarPath={r.avatar_path}
              trailing={
                <>
                  <RowButton
                    tone="primary"
                    disabled={respond.isPending}
                    onClick={() => respond.mutate({ user: r.user_id!, accept: true })}
                  >
                    {t('social:accept')}
                  </RowButton>
                  <RowButton
                    disabled={respond.isPending}
                    onClick={() => respond.mutate({ user: r.user_id!, accept: false })}
                  >
                    {t('social:decline')}
                  </RowButton>
                </>
              }
            />
          ))}
        </GroupedList>
      )}
      <ErrorNote error={respond.error ?? requests.error} />

      <GroupedList title={t('social:settings.blocked')} footer={t('social:settings.blockedHint')}>
        {(blocked.data ?? []).map((b) => (
          <PersonRow
            key={b.user_id}
            userId={null}
            name={b.display_name}
            username={b.username}
            avatarPath={b.avatar_path}
            trailing={
              <RowButton
                disabled={unblock.isPending}
                onClick={() => unblock.mutate(b.user_id!)}
                label={t('social:settings.unblockLabel', { name: b.display_name })}
              >
                {t('social:settings.unblock')}
              </RowButton>
            }
          />
        ))}
        {blocked.data?.length === 0 && (
          <ListRow label={t('social:settings.nobodyBlocked')} className="text-ink-muted" />
        )}
      </GroupedList>
      <ErrorNote error={unblock.error ?? blocked.error} />

      <GroupedList title={t('social:settings.leaveTitle')} footer={t('social:settings.leaveHint')}>
        <ListRow
          icon={PauseCircle}
          label={t('social:settings.pause')}
          hint={t('social:settings.pauseHint')}
          onClick={() => setLeave('pause')}
          chevron={false}
        />
        <ListRow
          icon={Trash2}
          label={t('social:settings.leave')}
          destructive
          onClick={() => setLeave('delete')}
          chevron={false}
        />
      </GroupedList>

      <ConfirmSheet
        open={leave === 'pause'}
        title={t('social:settings.pauseTitle')}
        body={t('social:settings.pauseBody')}
        confirmLabel={t('social:settings.pause')}
        pending={disable.isPending}
        error={disable.error}
        onConfirm={() => disable.mutate(false)}
        onCancel={() => setLeave(null)}
      />
      <ConfirmSheet
        open={leave === 'delete'}
        title={t('social:settings.leaveConfirmTitle')}
        body={
          <>
            <p>{t('social:settings.leaveConfirmBody')}</p>
            <p className="mt-2 inline-flex items-center gap-1.5 font-medium text-danger">
              <LogOut className="size-4" aria-hidden />
              {t('social:settings.leaveIrreversible')}
            </p>
          </>
        }
        confirmLabel={t('social:settings.leave')}
        tone="danger"
        pending={disable.isPending}
        error={disable.error}
        onConfirm={() => disable.mutate(true)}
        onCancel={() => setLeave(null)}
      />
    </div>
  )
}
