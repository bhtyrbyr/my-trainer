import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { Hash } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { normalizeTag } from '../hashtags'
import { useSocialMe, useTagPosts } from '../hooks'
import { JoinIntro } from '../components/JoinIntro'
import { BackLink, EmptyState, ListSkeleton, PostList } from '../components/parts'

/** /social/tag/:tag: posts carrying one hashtag that the viewer may see (social_tag_posts applies can_view_post). */
export function TagPage() {
  const { tag: raw = '' } = useParams()
  const tag = normalizeTag(raw)
  const { t } = useTranslation('social')
  const me = useSocialMe()
  const enabled = me.data?.enabled === true
  const posts = useTagPosts(tag, enabled)
  const title = `#${tag}`
  return (
    <PageShell title={title} leading={<BackLink title={title} />} className={enabled && !posts.isLoading ? 'pt-0' : undefined}>
      <div className="mx-auto max-w-xl pb-6">
        {me.isLoading ? (
          <ListSkeleton tall />
        ) : me.error ? (
          <ErrorNote error={me.error} />
        ) : !enabled ? (
          <JoinIntro paused={me.data?.enabled === false && me.data.enabled_at != null} />
        ) : (
          <PostList
            query={posts}
            flush
            empty={<EmptyState icon={Hash} title={t('tags.emptyTitle')} body={t('tags.emptyBody', { tag })} />}
          />
        )}
      </div>
    </PageShell>
  )
}
