import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Images } from 'lucide-react'
import { toPost } from '../payload'
import type { PostItem } from '../types'
import { MediaImage } from './PayloadBlocks'

/** Instagram-style 3-column grid of the posts that carry media; each tile opens the post. */
export function PostGrid({ posts }: { posts: PostItem[] }) {
  const { t } = useTranslation('share')
  const items = posts.map(toPost).filter((p) => p.media.length > 0)
  if (!items.length) return <p className="px-4 py-14 text-center text-[14px] text-ink-muted">{t('grid.empty')}</p>
  return (
    <ul className="grid grid-cols-3 gap-0.5" aria-label={t('layout.grid')}>
      {items.map((p) => (
        <li key={p.id} className="relative aspect-square bg-raised">
          <Link to={`/social/p/${p.id}`} aria-label={p.body ? p.body.slice(0, 80) : t(`kinds.${p.kind}`)} className="block size-full">
            <MediaImage media={p.media[0]} n={1} total={p.media.length} />
            {p.media.length > 1 && <Images className="absolute right-1.5 top-1.5 size-4 text-white drop-shadow" aria-hidden />}
          </Link>
        </li>
      ))}
    </ul>
  )
}
