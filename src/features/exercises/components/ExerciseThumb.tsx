import { Dumbbell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMediaUrl } from '../hooks'

/** Square GIF thumbnail on a light card (ExerciseDB GIFs have white backgrounds). Falls back to an icon. */
export function ExerciseThumb({ gifPath, size = 56, className }: { gifPath: string | null; size?: number; className?: string }) {
  const { data: url } = useMediaUrl(gifPath)
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-input)] bg-white', !gifPath && 'bg-raised', className)}
      style={{ width: size, height: size }}
    >
      {gifPath && url ? (
        <img src={url} alt="" loading="lazy" decoding="async" className="size-full object-contain" />
      ) : (
        <Dumbbell className="size-5 text-ink-faint" aria-hidden />
      )}
    </span>
  )
}
