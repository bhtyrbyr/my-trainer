import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, ImageOff, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSignedUrl, useStableSrc } from '../mediaCache'
import { useSharePreview } from '../previewContext'
import type { MediaRef } from '../types'

const SWIPE_PX = 48

/**
 * Full-screen viewer for a post's images (max 4): swipe or arrows to move, Escape or the close button to
 * leave. Portalled to <body> so no transformed ancestor traps it; URLs come from the in-memory cache.
 */
export function ImageViewer({ media, start, onClose }: { media: MediaRef[]; start: number; onClose: () => void }) {
  const { t } = useTranslation('share')
  const [index, setIndex] = useState(() => Math.min(Math.max(0, start), media.length - 1))
  const closeRef = useRef<HTMLButtonElement>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const total = media.length
  const go = (d: -1 | 1) => setIndex((i) => Math.min(total - 1, Math.max(0, i + d)))

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1))
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(total - 1, i + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, total])

  const current = media[index]
  if (!current) return null
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t('viewer.title')} className="fixed inset-0 z-[80] flex flex-col bg-bg pb-safe pt-safe">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 px-2">
        <p className="tabular px-3 text-[13px] font-semibold text-ink-muted" aria-live="polite">
          {total > 1 ? t('viewer.count', { n: index + 1, total }) : ''}
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t('viewer.close')}
          className="flex size-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
        >
          <X className="size-6" aria-hidden />
        </button>
      </header>

      <div
        className="relative min-h-0 flex-1 touch-pan-y select-none"
        onPointerDown={(e) => (swipe.current = { x: e.clientX, y: e.clientY })}
        onPointerCancel={() => (swipe.current = null)}
        onPointerUp={(e) => {
          const s = swipe.current
          swipe.current = null
          if (!s) return
          const dx = e.clientX - s.x
          if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(dx < 0 ? 1 : -1)
        }}
      >
        <ViewerImage key={current.path} media={current} n={index + 1} total={total} />
        {total > 1 && (
          <>
            <Arrow side="left" disabled={index === 0} label={t('viewer.prev')} onClick={() => go(-1)} />
            <Arrow side="right" disabled={index === total - 1} label={t('viewer.next')} onClick={() => go(1)} />
          </>
        )}
      </div>

      {total > 1 && (
        <div className="flex h-11 shrink-0 items-center justify-center gap-2" aria-hidden>
          {media.map((m, i) => (
            <span key={m.path} className={cn('size-1.5 rounded-full transition-colors', i === index ? 'bg-ink' : 'bg-ink-faint/50')} />
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}

function Arrow({ side, disabled, label, onClick }: { side: 'left' | 'right'; disabled: boolean; label: string; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/80 text-ink backdrop-blur transition-opacity hover:bg-surface disabled:opacity-0',
        side === 'left' ? 'left-2' : 'right-2',
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  )
}

function ViewerImage({ media, n, total }: { media: MediaRef; n: number; total: number }) {
  const { t } = useTranslation('share')
  const preview = useSharePreview()
  const { url, failed } = useSignedUrl(media.path, preview?.resolveMedia)
  const stable = useStableSrc(url)
  if (failed) {
    return (
      <p className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[13px] text-ink-muted">
        <ImageOff className="size-6" aria-hidden />
        {t('card.mediaFailed')}
      </p>
    )
  }
  if (!url) return <span className="absolute inset-0 animate-pulse bg-surface motion-reduce:animate-none" aria-hidden />
  return (
    <img
      src={stable.src ?? url}
      onLoad={stable.onLoad}
      alt={t('card.mediaAlt', { n, total })}
      width={media.width}
      height={media.height}
      draggable={false}
      className="absolute inset-0 size-full object-contain"
    />
  )
}
