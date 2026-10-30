import { cn } from '@/lib/utils'
import { useMediaUrl } from '../hooks'
import { exerciseMedia } from '../media'
import type { Exercise } from '../types'
import { Flipbook } from './Flipbook'
import { MuscleGlyph } from './MuscleMap'

type ThumbExercise = Pick<Exercise, 'media_frames' | 'gif_path' | 'target_muscles' | 'secondary_muscles'>

/**
 * Square thumbnail beside an exercise name (decorative: the name next to it carries the meaning).
 * First illustration frame, still, in ink on a raised plate; a leftover legacy GIF on its white card;
 * otherwise the muscle figure with the target muscles in volt.
 */
export function ExerciseThumb({ exercise, size = 56, className }: { exercise: ThumbExercise | null | undefined; size?: number; className?: string }) {
  const media = exerciseMedia(exercise)
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-input)]',
        media.kind === 'gif' ? 'bg-white' : 'bg-raised',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {media.kind === 'frames' ? (
        <Flipbook paths={media.paths} still className="size-full" />
      ) : media.kind === 'gif' ? (
        <LegacyGif path={media.path} />
      ) : exercise ? (
        <MuscleGlyph target={exercise.target_muscles} secondary={exercise.secondary_muscles} className="h-[86%]" />
      ) : null}
    </span>
  )
}

function LegacyGif({ path }: { path: string }) {
  const { data: url } = useMediaUrl(path)
  return url ? <img src={url} alt="" loading="lazy" decoding="async" className="size-full object-contain" /> : null
}
