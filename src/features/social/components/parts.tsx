import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Bell, Loader2, Plus, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { cn } from '@/lib/utils'
import type { PostsQuery } from '../hooks'
import { useUnreadCount } from '../hooks'
import { Avatar } from './Avatar'
import { PostCard, PostGrid } from './shareBridge'

/** A person in a social list: avatar and name link to the profile, optional trailing actions. */
export function PersonRow({
  userId,
  name,
  username,
  avatarPath,
  hint,
  trailing,
}: {
  userId: string | null
  name: string | null
  username: string | null
  avatarPath: string | null
  hint?: ReactNode
  trailing?: ReactNode
}) {
  return (
    <div className="flex min-h-[60px] items-center gap-3 px-4 py-2">
      <Avatar path={avatarPath} userId={userId} size={40} label={name ?? ''} />
      <Link to={`/social/u/${userId}`} className="min-w-0 flex-1 py-1">
        <span className="block truncate text-[15px] font-medium text-ink">{name}</span>
        <span className="block truncate text-[12px] text-ink-faint">
          @{username}
          {hint && <> · {hint}</>}
        </span>
      </Link>
      {trailing && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
    </div>
  )
}

/** Back control for pushed social screens: history back when there is one, else the fallback route. */
export function BackLink({ fallback = '/social', title }: { fallback?: string; title: string }) {
  const { t } = useTranslation('social')
  const navigate = useNavigate()
  const canGoBack = typeof window !== 'undefined' && (window.history.state?.idx ?? 0) > 0
  return (
    <div className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        aria-label={t('back')}
        onClick={() => (canGoBack ? navigate(-1) : navigate(fallback))}
        className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </button>
      <span className="truncate text-lg font-bold tracking-tight">{title}</span>
    </div>
  )
}

export function BellButton() {
  const { t } = useTranslation('social')
  const unread = useUnreadCount()
  return (
    <Link
      to="/social/notifications"
      aria-label={unread > 0 ? t('notifications.openUnread', { count: unread }) : t('notifications.title')}
      className="relative -mr-2 flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
    >
      <Bell className="size-[22px]" aria-hidden />
      {unread > 0 && (
        <span className="tabular absolute right-1 top-1 flex min-w-[18px] items-center justify-center rounded-full bg-volt px-1 text-[10px] font-bold leading-[18px] text-volt-ink ring-2 ring-bg">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  )
}

/** Primary "Share" action: a 56 px volt disc above the tab bar, right thumb zone, clear of the centre tab. */
export function ShareFab({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('social')
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('share')}
      className="fixed right-4 z-30 flex size-14 items-center justify-center rounded-full bg-volt text-volt-ink transition-transform hover:bg-volt-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:scale-95 bottom-[calc(var(--nav-h)+var(--sab)+16px)] lg:absolute lg:bottom-6"
    >
      <Plus className="size-6" strokeWidth={2.5} aria-hidden />
    </button>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <Icon className="size-8 text-ink-faint" strokeWidth={1.5} aria-hidden />
      <p className="mt-4 text-[17px] font-semibold">{title}</p>
      {body && <p className="mt-1.5 max-w-[32ch] text-[14px] leading-relaxed text-ink-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ListSkeleton({ rows = 3, tall }: { rows?: number; tall?: boolean }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={cn(
            'hairline animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none',
            tall ? 'h-40' : 'h-16',
          )}
        />
      ))}
    </div>
  )
}

/** Timeline placeholder: avatar and text lines on the page, hairline dividers, no boxes. */
export function TimelineSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="-mx-4 divide-y divide-line border-y border-line" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3 px-4 py-3 motion-safe:animate-pulse">
          <span className="size-10 shrink-0 rounded-full bg-raised" />
          <span className="flex-1 space-y-2 pt-1">
            <span className="block h-3 w-2/5 rounded-full bg-raised" />
            <span className="block h-3 w-11/12 rounded-full bg-raised" />
            <span className="block h-3 w-3/5 rounded-full bg-raised" />
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Infinite post list: loads the next keyset page when the sentinel scrolls into view (button fallback).
 * `list` is the full-bleed timeline (rows split by hairlines); `grid` shows the posts with media, 3 across.
 */
export function PostList({ query, empty, layout = 'list' }: { query: PostsQuery; empty: ReactNode; layout?: 'list' | 'grid' }) {
  const { t } = useTranslation('social')
  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query

  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && !isFetchingNextPage && void fetchNextPage(),
      { rootMargin: '400px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const posts = query.data?.pages.flat() ?? []
  if (query.isLoading) return <TimelineSkeleton />
  return (
    <div>
      <ErrorNote error={query.error} className="mb-3" />
      {posts.length === 0 && !query.error ? (
        empty
      ) : layout === 'grid' ? (
        <div className="-mx-4">
          <PostGrid posts={posts} />
        </div>
      ) : (
        <ul className="-mx-4 divide-y divide-line border-y border-line" aria-label={t('posts')}>
          {posts.map((p) => (
            <li key={p.id}>
              <PostCard post={p} />
            </li>
          ))}
        </ul>
      )}
      <div ref={sentinel} />
      {hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="ghost" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** Small inline pill buttons used in rows (accept / decline / remove). */
export function RowButton({
  children,
  onClick,
  tone = 'secondary',
  disabled,
  label,
}: {
  children: ReactNode
  onClick: () => void
  tone?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        // 44 px hit area around a 32 px pill
        'relative flex h-11 items-center px-0.5 disabled:opacity-50',
      )}
    >
      <span
        className={cn(
          'flex h-8 items-center rounded-full px-3.5 text-[13px] font-semibold',
          tone === 'primary' && 'bg-volt text-volt-ink',
          tone === 'secondary' && 'hairline bg-raised text-ink',
          tone === 'danger' && 'hairline bg-raised text-danger',
        )}
      >
        {children}
      </span>
    </button>
  )
}
