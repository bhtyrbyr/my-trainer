import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNowStrict } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { BellOff, Loader2 } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { PLAIN_LIST } from '@/components/ui/GroupedList'
import { cn } from '@/lib/utils'
import * as api from '../api'
import { notificationTarget } from '../logic'
import { socialKeys, useNotifications, useSocialAction } from '../hooks'
import type { SocialNotification } from '../schema'
import { Avatar } from '../components/Avatar'
import { BackLink, EmptyState, ListSkeleton, RowButton } from '../components/parts'

/**
 * /social/notifications. Unread rows keep a volt dot for this visit; everything shown is marked read
 * right away. Follow requests and group invites are answered inline.
 */
export function NotificationsPage() {
  const { t } = useTranslation('social')
  const qc = useQueryClient()
  const list = useNotifications()
  const items = list.data?.pages.flat() ?? []
  const [seenUnread] = useState(() => new Set<string>())
  const marked = useRef(new Set<string>())

  useEffect(() => {
    const fresh = items.filter((n) => !n.read_at && n.id && !marked.current.has(n.id)).map((n) => n.id!)
    if (fresh.length === 0) return
    fresh.forEach((id) => {
      marked.current.add(id)
      seenUnread.add(id)
    })
    void api.markRead(fresh).then(() => qc.invalidateQueries({ queryKey: socialKeys.unread }))
  }, [items, qc, seenUnread])

  return (
    <PageShell title={t('notifications.title')} leading={<BackLink title={t('notifications.title')} />}>
      <div className="mx-auto max-w-xl pb-6">
        <ErrorNote error={list.error} className="mb-3" />
        {list.isLoading ? (
          <ListSkeleton rows={5} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title={t('notifications.emptyTitle')}
            body={t('notifications.emptyBody')}
          />
        ) : (
          <ul className={PLAIN_LIST}>
            {items.map((n) => (
              <NotificationRow key={n.id} n={n} unread={seenUnread.has(n.id!) || !n.read_at} />
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="ghost"
              onClick={() => void list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
            >
              {list.isFetchingNextPage && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('loadMore')}
            </Button>
          </div>
        )}
        <p className="mt-4 px-1 text-center text-[12px] text-ink-faint">{t('notifications.retention')}</p>
      </div>
    </PageShell>
  )
}

function NotificationRow({ n, unread }: { n: SocialNotification; unread: boolean }) {
  const { t, i18n } = useTranslation('social')
  const locale = i18n.resolvedLanguage === 'en' ? enUS : tr
  const [answered, setAnswered] = useState<null | 'accepted' | 'declined'>(null)
  const follow = useSocialAction(
    (accept: boolean) => api.respondFollow(n.actor_id!, accept),
    (_r, a) => setAnswered(a ? 'accepted' : 'declined'),
    'notifications',
  )
  const group = useSocialAction(
    (accept: boolean) => api.respondGroup(n.group_id!, accept),
    (_r, a) => setAnswered(a ? 'accepted' : 'declined'),
    'notifications',
  )
  const m = n.kind === 'follow_request' ? follow : n.kind === 'group_invite' ? group : null
  const to = notificationTarget(n)
  const name = n.actor_display_name ?? t('notifications.someone')
  const text = t(`notifications.kinds.${n.kind}`, { name, group: n.group_name ?? '' })
  const when = n.created_at
    ? formatDistanceToNowStrict(new Date(n.created_at), { locale, addSuffix: true })
    : ''

  return (
    <li className={cn('flex items-start gap-3 px-4 py-3', unread && 'bg-volt/[0.05]')}>
      <Avatar path={n.actor_avatar_path} userId={n.actor_id} size={40} label={name} />
      <div className="min-w-0 flex-1">
        {to ? (
          <Link to={to} className="block text-[14px] leading-snug text-ink-muted">
            <Message text={text} name={name} />
          </Link>
        ) : (
          <p className="text-[14px] leading-snug text-ink-muted">
            <Message text={text} name={name} />
          </p>
        )}
        <p className="mt-0.5 text-[12px] text-ink-faint">{when}</p>
        {m && !answered && (
          <div className="-ml-0.5 mt-1 flex">
            <RowButton tone="primary" disabled={m.isPending} onClick={() => m.mutate(true)}>
              {t('accept')}
            </RowButton>
            <RowButton disabled={m.isPending} onClick={() => m.mutate(false)}>
              {t('decline')}
            </RowButton>
          </div>
        )}
        {answered && (
          <p className="mt-1 text-[13px] font-medium text-ink-muted">{t(`notifications.${answered}`)}</p>
        )}
        <ErrorNote error={m?.error} className="mt-2" />
      </div>
      {unread && (
        <span className="mt-2 size-2 shrink-0 rounded-full bg-volt" aria-label={t('notifications.unread')} />
      )}
    </li>
  )
}

/** Bolds the actor's name inside the translated sentence. */
function Message({ text, name }: { text: string; name: string }) {
  const i = text.indexOf(name)
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <span className="font-semibold text-ink">{name}</span>
      {text.slice(i + name.length)}
    </>
  )
}
