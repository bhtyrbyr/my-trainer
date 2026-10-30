import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { useInView, useReducedMotion } from '@/lib/motion'
import { useMediaUrls } from '../hooks'
import { FRAME_MS } from '../media'

type Props = {
  /** storage paths in exercise-media, played in order */
  paths: string[]
  /** accessible name of the illustration; omit for decorative use (thumbnails next to the name) */
  label?: string
  /** first frame only (thumbnails) */
  still?: boolean
  className?: string
}

/**
 * Exercise illustration as a flipbook: the frames (white line art on transparent) are used as CSS
 * masks, so the drawing paints in the theme's ink on any plate. One frame per FRAME_MS, hard cuts;
 * it starts once every frame has loaded, pauses while off-screen, and shows only the first frame
 * under prefers-reduced-motion or `still`.
 */
export function Flipbook(props: Props) {
  // a new exercise starts again at frame one
  return <FlipbookPlayer key={props.paths.join('|')} {...props} />
}

function FlipbookPlayer({ paths, label, still, className }: Props) {
  const reduced = useReducedMotion()
  const shown = still || reduced ? paths.slice(0, 1) : paths
  const { data: urls } = useMediaUrls(shown)
  const list = shown.map((p) => urls[p])
  const loaded = useAllLoaded(list)

  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const [frame, setFrame] = useState(0)
  const playing = shown.length > 1 && loaded && inView

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => setFrame((f) => (f + 1) % shown.length), FRAME_MS)
    return () => window.clearInterval(id)
  }, [playing, shown.length])

  const current = frame % shown.length
  return (
    <div
      ref={ref}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('relative', className)}
    >
      {list[0] ? (
        list.map((url, i) =>
          url ? (
            isLineArt(shown[i]) ? (
              <span
                key={shown[i]}
                className={cn('absolute inset-0 bg-ink', i === current ? 'opacity-100' : 'opacity-0')}
                style={maskStyle(url)}
              />
            ) : (
              // photos and raster drawings (wger PNG/WebP) are shown as they are, on a white plate
              <img
                key={shown[i]}
                src={url}
                alt=""
                className={cn('absolute inset-0 size-full rounded-[inherit] bg-white object-contain', i === current ? 'opacity-100' : 'opacity-0')}
              />
            )
          ) : null,
        )
      ) : (
        <span className="absolute inset-[18%] animate-pulse rounded-full bg-raised/70" />
      )}
    </div>
  )
}

/** Only the SVG line art (transparent) works as a theme-coloured mask. */
function isLineArt(path: string): boolean {
  return path.toLowerCase().endsWith('.svg')
}

function maskStyle(url: string): CSSProperties {
  const image = `url("${url}")`
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
  }
}

/** True once every URL is known and fetched (CORS mode, like the mask fetch, so the cache is shared). */
function useAllLoaded(urls: (string | undefined)[]): boolean {
  const complete = urls.length > 0 && urls.every(Boolean)
  const key = complete ? urls.join('\n') : ''
  const [loadedKey, setLoadedKey] = useState('')
  useEffect(() => {
    if (!key) return
    let cancelled = false
    const load = (src: string) =>
      new Promise<void>((resolve) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = img.onerror = () => resolve()
        img.src = src
      })
    void Promise.all(key.split('\n').map(load)).then(() => {
      if (!cancelled) setLoadedKey(key)
    })
    return () => {
      cancelled = true
    }
  }, [key])
  return Boolean(key) && loadedKey === key
}
