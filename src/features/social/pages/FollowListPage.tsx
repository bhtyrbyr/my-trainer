import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { Users } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { GroupedList } from '@/components/ui/GroupedList'
import { SectionTabs } from '@/components/ui/SectionTabs'
import { useAuth } from '@/features/auth/AuthProvider'
import * as api from '../api'
import { useFollowers, useFollowing, useSocialAction, useSocialProfile } from '../hooks'
import type { Person } from '../schema'
import { BackLink, EmptyState, ListSkeleton, PersonRow, RowButton } from '../components/parts'

const LISTS = ['followers', 'following'] as const

/** /social/u/:id/followers | following. On your own followers list each row can be removed. */
export function FollowListPage() {
  const { id = '', list } = useParams()
  const { t } = useTranslation('social')
  const navigate = useNavigate()
  const { user } = useAuth()
  const mode = list === 'following' ? 'following' : 'followers'
  const profile = useSocialProfile(id)
  const followers = useFollowers(id, mode === 'followers')
  const following = useFollowing(id, mode === 'following')
  const q = mode === 'followers' ? followers : following
  const own = id === user?.id
  const [removing, setRemoving] = useState<Person | null>(null)
  const remove = useSocialAction(
    (uid: string) => api.removeFollower(uid),
    () => setRemoving(null),
  )

  return (
    <PageShell
      title={t(`profile.${mode}List`)}
      leading={
        <BackLink
          fallback={`/social/u/${id}`}
          title={profile.data?.display_name ?? t(`profile.${mode}List`)}
        />
      }
    >
      <div className="mx-auto max-w-xl space-y-5 pb-6">
        <SectionTabs
          label={t('profile.lists')}
          options={LISTS}
          value={mode}
          onChange={(v) => navigate(`/social/u/${id}/${v}`, { replace: true })}
          labelOf={(v) => t(`profile.${v}List`)}
        />
        <ErrorNote error={q.error} />
        {q.isLoading ? (
          <ListSkeleton rows={4} />
        ) : (q.data ?? []).length === 0 ? (
          <EmptyState icon={Users} title={t(`profile.${mode}Empty`)} />
        ) : (
          <GroupedList>
            {(q.data ?? []).map((p) => (
              <PersonRow
                key={p.user_id}
                userId={p.user_id}
                name={p.display_name}
                username={p.username}
                avatarPath={p.avatar_path}
                trailing={
                  own && mode === 'followers' ? (
                    <RowButton
                      onClick={() => setRemoving(p)}
                      label={t('profile.removeFollowerLabel', { name: p.display_name })}
                    >
                      {t('profile.removeFollower')}
                    </RowButton>
                  ) : undefined
                }
              />
            ))}
          </GroupedList>
        )}
      </div>
      <ConfirmSheet
        open={removing !== null}
        title={t('profile.removeFollowerTitle', { name: removing?.display_name ?? '' })}
        body={t('profile.removeFollowerBody')}
        confirmLabel={t('profile.removeFollower')}
        tone="danger"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => removing && remove.mutate(removing.user_id!)}
        onCancel={() => setRemoving(null)}
      />
    </PageShell>
  )
}
