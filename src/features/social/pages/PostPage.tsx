import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { EyeOff } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { usePost } from '../hooks'
import { BackLink, EmptyState, ListSkeleton } from '../components/parts'
import { PostCard } from '../components/shareBridge'

/** /social/p/:id: one post (deep link from a like notification); social_post applies can_view_post. */
export function PostPage() {
  const { id = '' } = useParams()
  const { t } = useTranslation('social')
  const post = usePost(id)
  return (
    <PageShell title={t('post')} leading={<BackLink fallback="/social/notifications" title={t('post')} />}>
      <div className="mx-auto max-w-xl pb-6">
        {post.isLoading ? (
          <ListSkeleton rows={1} tall />
        ) : post.error ? (
          <ErrorNote error={post.error} />
        ) : post.data ? (
          <PostCard post={post.data} />
        ) : (
          <EmptyState icon={EyeOff} title={t('postGoneTitle')} body={t('postGoneBody')} />
        )}
      </div>
    </PageShell>
  )
}
