import { Link } from 'react-router-dom'
import { UserRound } from 'lucide-react'
import { avatarUrl } from '@/features/profile/api'
import { cn } from '@/lib/utils'

/** Round avatar; with `userId` it links to the social profile (every avatar in the social area does). */
export function Avatar({
  path,
  size = 40,
  userId,
  label,
  className,
}: {
  path: string | null | undefined
  size?: number
  userId?: string | null
  label?: string
  className?: string
}) {
  const src = avatarUrl(path)
  const img = (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-raised text-ink-faint',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt="" width={size} height={size} loading="lazy" className="size-full object-cover" />
      ) : (
        <UserRound style={{ width: size * 0.5, height: size * 0.5 }} aria-hidden />
      )}
    </span>
  )
  if (!userId) return img
  return (
    <Link to={`/social/u/${userId}`} aria-label={label} className="shrink-0 rounded-full">
      {img}
    </Link>
  )
}
