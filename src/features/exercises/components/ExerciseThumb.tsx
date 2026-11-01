import { cn } from '@/lib/utils'
import type { Exercise } from '../types'
import { useExerciseMedia } from '../useExerciseMedia'
import { BodyGlyph } from './BodyMap'
import { ExerciseGif } from './ExerciseGif'
import { Flipbook } from './Flipbook'

type ThumbExercise = Pick<Exercise, 'media_frames' | 'target_muscles' | 'secondary_muscles'> &
  Partial<Pick<Exercise, 'exercisedb_id'>>

/**
 * Square thumbnail beside an exercise name (decorative: the name next to it carries the meaning).
 * The ExerciseDB GIF square-cropped on the light plate; else the first illustration frame, still, in ink
 * on a raised plate; else the body figure with the worked muscles in volt.
 */
export function ExerciseThumb({ exercise, size = 56, className }: { exercise: ThumbExercise | null | undefined; size?: number; className?: string }) {
  const { media, onGifError } = useExerciseMedia(exercise)
  return (
    <span
      aria-hidden
      className={cn(
        'isolate flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-input)]',
        media.kind === 'gif' ? 'bg-plate' : media.kind === 'frames' ? 'bg-raised' : 'bg-surface',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {media.kind === 'gif' ? (
        <ExerciseGif url={media.url} onError={onGifError} crop />
      ) : media.kind === 'frames' ? (
        <Flipbook paths={media.paths} still className="size-full" />
      ) : exercise ? (
        <BodyGlyph target={exercise.target_muscles} secondary={exercise.secondary_muscles} gap="var(--color-surface)" />
      ) : null}
    </span>
  )
}
