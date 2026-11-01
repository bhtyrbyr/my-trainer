import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { Check, Flag, Heart, MoreHorizontal, Trash2, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { GroupedList, ListRow } from '@/components/ui/GroupedList'
import { Sheet } from '@/components/ui/Sheet'
import { useAuth } from '@/features/auth/AuthProvider'
import { cn } from '@/lib/utils'
import { Avatar } from '../../components/Avatar'
import { AUDIENCE_ICON, audienceReady } from '../audience'
import { useDateFnsLocale, useDeletePost, useLike, useReportPost, useSetAudience } from '../hooks'
import { REASON_MAX, readMeal, readProgram, readWorkout, relativeTime, toPost } from '../payload'
import { useSharePreview } from '../previewContext'
import type { AudienceChoice, Post, PostItem } from '../types'
import { AudiencePicker } from './AudiencePicker'
import { MealBlock, MediaGrid, ProgramBlock, WorkoutBlock } from './PayloadBlocks'

/**
 * One post as a timeline row (X-style): avatar column, content column, no container. The list draws the
 * hairline dividers; media and payload attachments sit inside the content column.
 */
export function PostCard({ post: item }: { post: PostItem }) {
  const { t } = useTranslation('share')
  const post = toPost(item)
  const { user } = useAuth()
  const preview = useSharePreview()
  const mine = post.author_id === (preview?.meId ?? user?.id)
  const [menu, setMenu] = useState(false)
  const [sheet, setSheet] = useState<'audience' | 'delete' | 'report' | null>(null)
  const [deleted, setDeleted] = useState(false)
  const workout = post.kind === 'workout' ? readWorkout(post.payload) : null
  const program = post.kind === 'program' ? readProgram(post.payload) : null
  const meal = post.kind === 'meal' ? readMeal(post.payload) : null
  const name = post.author_display_name || post.author_username
  const open = (s: 'audience' | 'delete' | 'report') => {
    setMenu(false)
    setSheet(s)
  }

  if (deleted) return null
  return (
    <article className="px-4 pt-3" aria-label={name}>
      {post.audience === 'group' && post.group_name && post.group_id && (
        <Link
          to={`/social/g/${post.group_id}`}
          className="-mt-0.5 mb-1 flex items-center gap-1.5 pl-[26px] text-[13px] font-medium text-ink-faint hover:text-ink-muted"
        >
          <UsersRound className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{t('card.inGroup', { group: post.group_name })}</span>
        </Link>
      )}
      <div className="flex gap-3">
        <Avatar path={preview ? null : post.author_avatar_path} userId={post.author_id} size={40} label={name} />
        <div className="min-w-0 flex-1">
          <Header post={post} name={name} onMenu={() => setMenu(true)} />
          {post.body && <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-[1.45] text-ink">{post.body}</p>}
          {post.media.length > 0 && (
            <div className="mt-2.5">
              <MediaGrid media={post.media} />
            </div>
          )}
          {(workout || program || meal) && (
            <div className="mt-2.5">
              {workout && <WorkoutBlock payload={workout} />}
              {program && <ProgramBlock payload={program} canCopy={!mine} />}
              {meal && <MealBlock payload={meal} />}
            </div>
          )}
          <LikeRow key={`${post.id}:${post.like_count}:${post.liked_by_me}`} post={post} />
        </div>
      </div>

      <Sheet open={menu} label={t('card.menu')} closeLabel={t('composer.close')} onClose={() => setMenu(false)}>
        <GroupedList className="pb-5">
          {mine ? (
            <>
              <ListRow icon={AUDIENCE_ICON[post.audience]} label={t('menu.audience')} onClick={() => open('audience')} />
              <ListRow icon={Trash2} destructive chevron={false} label={t('menu.delete')} onClick={() => open('delete')} />
            </>
          ) : (
            <ListRow icon={Flag} label={t('menu.report')} onClick={() => open('report')} />
          )}
        </GroupedList>
      </Sheet>

      {mine && <DeleteSheet open={sheet === 'delete'} postId={post.id} onClose={() => setSheet(null)} onDeleted={() => setDeleted(true)} />}
      {mine && sheet === 'audience' && (
        <AudienceSheet postId={post.id} initial={{ audience: post.audience, groupId: post.group_id }} onClose={() => setSheet(null)} />
      )}
      {!mine && sheet === 'report' && <ReportSheet postId={post.id} onClose={() => setSheet(null)} />}
    </article>
  )
}

/** name · @username · time · audience on one line; the menu sits on the far right with a 44 pt target. */
function Header({ post, name, onMenu }: { post: Post; name: string; onMenu: () => void }) {
  const { t } = useTranslation('share')
  const locale = useDateFnsLocale()
  const created = new Date(post.created_at)
  const rel = relativeTime(created, new Date())
  const when = rel.unit === 'date' ? format(created, 'd MMM', { locale }) : rel.unit === 'now' ? t('time.now') : t(`time.${rel.unit}`, { count: rel.n })
  const AudienceIcon = AUDIENCE_ICON[post.audience]
  const audienceLabel = post.audience === 'group' && post.group_name ? t('card.inGroup', { group: post.group_name }) : t(`audience.${post.audience}`)
  return (
    <div className="flex items-start gap-1">
      <div className="flex min-w-0 flex-1 items-baseline gap-1 pt-0.5 text-[15px] leading-5">
        <Link to={`/social/u/${post.author_id}`} className="min-w-0 shrink-0 truncate font-semibold text-ink hover:underline max-w-[60%]">
          {name}
        </Link>
        {post.author_username && <span className="min-w-0 truncate text-ink-faint">@{post.author_username}</span>}
        <span aria-hidden className="shrink-0 text-ink-faint">
          ·
        </span>
        <Link to={`/social/p/${post.id}`} className="tabular shrink-0 text-ink-faint hover:underline">
          <time dateTime={post.created_at} title={format(created, 'd MMM yyyy HH:mm', { locale })}>
            {when}
          </time>
        </Link>
        <AudienceIcon className="ml-0.5 size-3.5 shrink-0 self-center text-ink-faint" role="img" aria-label={t('card.audienceIs', { audience: audienceLabel })} />
      </div>
      <button
        type="button"
        onClick={onMenu}
        aria-label={t('card.menu')}
        className="-mr-2.5 -mt-2.5 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-raised hover:text-ink"
      >
        <MoreHorizontal className="size-[18px]" aria-hidden />
      </button>
    </div>
  )
}

/** Optimistic like: flips at once, settles on the server's count, reverts on error. 44 pt target, small visual. */
function LikeRow({ post }: { post: Post }) {
  const { t } = useTranslation('share')
  const like = useLike()
  const [state, setState] = useState({ liked: post.liked_by_me, count: post.like_count })
  const toggle = () => {
    if (like.isPending) return
    const prev = state
    const next = { liked: !prev.liked, count: Math.max(0, prev.count + (prev.liked ? -1 : 1)) }
    setState(next)
    like.mutate(
      { postId: post.id, like: next.liked, count: next.count },
      { onSuccess: (count) => setState({ liked: next.liked, count }), onError: () => setState(prev) },
    )
  }
  return (
    <div className="mt-0.5 flex items-center">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={state.liked}
        aria-label={state.liked ? t('card.unlike') : t('card.like')}
        className={cn(
          'group -ml-2.5 flex h-11 min-w-11 items-center gap-1.5 px-2.5 text-[13px] transition-colors',
          state.liked ? 'text-volt' : 'text-ink-faint hover:text-ink-muted',
        )}
      >
        <Heart
          className={cn('size-[18px] transition-transform duration-150 group-active:scale-90 motion-reduce:transition-none', state.liked && 'fill-current')}
          aria-hidden
        />
        <span className="tabular min-w-[1ch]" aria-live="polite">
          {state.count > 0 ? state.count : ''}
          <span className="sr-only">{t('card.likes', { count: state.count })}</span>
        </span>
      </button>
      {like.isError && <ErrorNote error={like.error} className="min-w-0 flex-1" />}
    </div>
  )
}

function DeleteSheet({ open, postId, onClose, onDeleted }: { open: boolean; postId: string; onClose: () => void; onDeleted: () => void }) {
  const { t } = useTranslation('share')
  const del = useDeletePost()
  return (
    <ConfirmSheet
      open={open}
      title={t('delete.title')}
      body={t('delete.body')}
      confirmLabel={t('delete.confirm')}
      tone="danger"
      pending={del.isPending}
      error={del.error}
      onCancel={onClose}
      onConfirm={() =>
        del.mutate(postId, {
          onSuccess: () => {
            onClose()
            onDeleted()
          },
        })
      }
    />
  )
}

function AudienceSheet({ postId, initial, onClose }: { postId: string; initial: AudienceChoice; onClose: () => void }) {
  const { t } = useTranslation('share')
  const set = useSetAudience()
  const [value, setValue] = useState<AudienceChoice>(initial)
  return (
    <Sheet open label={t('audienceSheet.title')} closeLabel={t('composer.close')} onClose={onClose}>
      <h2 className="display text-[24px]">{t('audienceSheet.title')}</h2>
      <div className="mt-5">
        <AudiencePicker value={value} onChange={setValue} />
      </div>
      <ErrorNote error={set.error} className="mt-4" />
      <div className="mt-6 pb-5">
        <Button size="lg" className="w-full" disabled={!audienceReady(value) || set.isPending} onClick={() => set.mutate({ postId, target: value }, { onSuccess: onClose })}>
          {t('audienceSheet.save')}
        </Button>
      </div>
    </Sheet>
  )
}

function ReportSheet({ postId, onClose }: { postId: string; onClose: () => void }) {
  const { t } = useTranslation('share')
  const report = useReportPost()
  const [reason, setReason] = useState('')
  return (
    <Sheet open label={t('report.title')} closeLabel={t('composer.close')} onClose={onClose}>
      <h2 className="display text-[24px]">{t('report.title')}</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{t('report.body')}</p>
      {report.isSuccess ? (
        <div className="pb-5">
          <p className="mt-5 flex items-center gap-2 text-[15px] text-ink">
            <Check className="size-4 text-volt" aria-hidden />
            {t('report.sent')}
          </p>
          <Button size="lg" variant="secondary" className="mt-6 w-full" onClick={onClose}>
            {t('composer.close')}
          </Button>
        </div>
      ) : (
        <>
          <label className="mt-5 block">
            <span className="section-title mb-2 block px-1">{t('report.reason')}</span>
            <textarea
              value={reason}
              maxLength={REASON_MAX}
              rows={3}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('report.placeholder')}
              className="hairline w-full resize-none rounded-[var(--radius-input)] bg-bg px-3 py-2.5 text-[16px] text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-volt"
            />
          </label>
          <ErrorNote error={report.error} className="mt-3" />
          <div className="mt-5 pb-5">
            <Button size="lg" className="w-full" disabled={report.isPending} onClick={() => report.mutate({ postId, reason })}>
              {t('report.send')}
            </Button>
          </div>
        </>
      )}
    </Sheet>
  )
}
