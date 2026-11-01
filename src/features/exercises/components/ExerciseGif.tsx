import { cn } from '@/lib/utils'

type Props = {
  url: string
  /** accessible name; omit for decorative use (thumbnails next to the name) */
  label?: string
  onError: () => void
  /** square-crop to fill the box (thumbnails); otherwise contained at its own aspect */
  crop?: boolean
  className?: string
}

/**
 * An ExerciseDB animation, hot-linked: a plain <img> without referrer or CORS, never fetched by our code
 * or stored by the service worker. The GIFs are drawn on white; multiplied onto the `plate` surface
 * behind them, the white becomes the plate and the figure sits on it without a visible box edge.
 * Place it inside an element with `bg-plate isolate`.
 */
export function ExerciseGif({ url, label, onError, crop, className }: Props) {
  return (
    <img
      src={url}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={onError}
      className={cn(
        'mix-blend-multiply select-none',
        crop ? 'size-full object-cover' : 'max-h-full max-w-full object-contain',
        className,
      )}
    />
  )
}
