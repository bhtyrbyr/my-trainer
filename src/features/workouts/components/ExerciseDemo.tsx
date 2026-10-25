import { useTranslation } from 'react-i18next'
import { Dumbbell, Maximize2, Minimize2 } from 'lucide-react'
import { useMediaUrl } from '@/features/exercises'
import { cn } from '@/lib/utils'

type Props = {
  gifPath: string | null
  name: string
  expanded: boolean
  onToggle: () => void
}

/**
 * The movement GIF of the current exercise, playing while the set is done.
 * Compact: a 128px card beside the title. Expanded: a full-width stage (tap again to shrink).
 * ExerciseDB GIFs are 180px squares on white, so the stage stays white and caps the GIF near 2x.
 */
export function ExerciseDemo({ gifPath, name, expanded, onToggle }: Props) {
  const { t } = useTranslation('workouts')
  const { data: url } = useMediaUrl(gifPath)

  if (!gifPath) {
    return (
      <span className="hairline flex size-[76px] shrink-0 items-center justify-center rounded-[var(--radius-card)] bg-surface">
        <Dumbbell className="size-6 text-ink-faint" aria-hidden />
      </span>
    )
  }

  const Icon = expanded ? Minimize2 : Maximize2
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={expanded ? t('session.demoShrink') : t('session.demoEnlarge')}
      className={cn(
        'group relative flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-card)] bg-white',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt',
        expanded ? 'h-[min(58vw,240px)] w-full' : 'size-32',
      )}
    >
      {url ? (
        <img
          src={url}
          alt={t('session.demoAlt', { name })}
          loading="eager"
          decoding="async"
          fetchPriority="high"
          className={cn('object-contain', expanded ? 'h-full max-w-full' : 'size-full')}
        />
      ) : (
        <span className="size-full animate-pulse bg-black/5" aria-hidden />
      )}
      <span
        className="absolute bottom-1.5 right-1.5 flex size-7 items-center justify-center rounded-full bg-black/55 text-white transition-opacity group-hover:opacity-100 sm:opacity-80"
        aria-hidden
      >
        <Icon className="size-3.5" />
      </span>
    </button>
  )
}
