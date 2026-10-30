import { useTranslation } from 'react-i18next'
import { Maximize2, Minimize2 } from 'lucide-react'
import { exerciseMedia, Flipbook, MuscleGlyph, useMediaUrl, type Exercise } from '@/features/exercises'
import { cn } from '@/lib/utils'

type Props = {
  exercise: Exercise | undefined
  name: string
  expanded: boolean
  onToggle: () => void
}

/**
 * The movement of the current exercise while the set is done: its illustration frames as a flipbook,
 * a leftover legacy GIF, or the front and back muscle figures when there is no illustration.
 * Compact: a 128px card beside the title. Expanded: a full-width stage (tap again to shrink).
 */
export function ExerciseDemo({ exercise, name, expanded, onToggle }: Props) {
  const { t } = useTranslation('workouts')
  const media = exerciseMedia(exercise)
  const label = t('session.demoAlt', { name })

  const Icon = expanded ? Minimize2 : Maximize2
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={expanded ? t('session.demoShrink') : t('session.demoEnlarge')}
      className={cn(
        'group relative flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-card)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt',
        media.kind === 'gif' ? 'bg-white' : 'hairline bg-surface',
        expanded ? 'h-[min(58vw,240px)] w-full' : 'size-32',
      )}
    >
      {media.kind === 'frames' ? (
        <Flipbook paths={media.paths} label={label} className={expanded ? 'aspect-square h-[92%]' : 'size-[88%]'} />
      ) : media.kind === 'gif' ? (
        <LegacyGif path={media.path} label={label} expanded={expanded} />
      ) : exercise ? (
        <MuscleGlyph target={exercise.target_muscles} secondary={exercise.secondary_muscles} sides="both" className="h-[84%]" />
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

/** ExerciseDB GIFs (legacy rows during the catalog switch) are 180px squares on white. */
function LegacyGif({ path, label, expanded }: { path: string; label: string; expanded: boolean }) {
  const { data: url } = useMediaUrl(path)
  return url ? (
    <img
      src={url}
      alt={label}
      loading="eager"
      decoding="async"
      fetchPriority="high"
      className={cn('object-contain', expanded ? 'h-full max-w-full' : 'size-full')}
    />
  ) : (
    <span className="size-full animate-pulse bg-black/5" aria-hidden />
  )
}
