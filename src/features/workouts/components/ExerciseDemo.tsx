import { useTranslation } from 'react-i18next'
import { Maximize2, Minimize2 } from 'lucide-react'
import { BodyGlyph, ExerciseGif, Flipbook, useExerciseMedia, type Exercise } from '@/features/exercises'
import { cn } from '@/lib/utils'

type Props = {
  exercise: Exercise | undefined
  name: string
  expanded: boolean
  onToggle: () => void
}

/**
 * The movement of the current exercise while the set is done: the ExerciseDB GIF on the light plate,
 * else its illustration frames as a flipbook, else the front and back body figures.
 * Compact: a 128px card beside the title. Expanded: a full-width stage (tap again to shrink).
 */
export function ExerciseDemo({ exercise, name, expanded, onToggle }: Props) {
  const { t } = useTranslation('workouts')
  const { media, onGifError } = useExerciseMedia(exercise)
  const label = t('session.demoAlt', { name })

  const Icon = expanded ? Minimize2 : Maximize2
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={expanded ? t('session.demoShrink') : t('session.demoEnlarge')}
      className={cn(
        'group relative isolate flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-card)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt',
        media.kind === 'gif' ? 'bg-plate' : 'hairline bg-surface',
        expanded ? 'h-[min(58vw,240px)] w-full' : 'size-32',
      )}
    >
      {media.kind === 'gif' ? (
        <ExerciseGif url={media.url} label={label} onError={onGifError} className={expanded ? 'h-full' : 'size-full'} />
      ) : media.kind === 'frames' ? (
        <Flipbook paths={media.paths} label={label} className={expanded ? 'aspect-square h-[92%]' : 'size-[88%]'} />
      ) : exercise ? (
        <BodyGlyph target={exercise.target_muscles} secondary={exercise.secondary_muscles} sides="both" gap="var(--color-surface)" className="h-[84%]" />
      ) : null}
      <span
        className="absolute bottom-1.5 right-1.5 flex size-7 items-center justify-center rounded-full bg-black/55 text-white transition-opacity group-hover:opacity-100 sm:opacity-80"
        aria-hidden
      >
        <Icon className="size-3.5" />
      </span>
    </button>
  )
}
