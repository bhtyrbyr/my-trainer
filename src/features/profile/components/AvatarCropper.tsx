import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cropToSquareJpeg, type CropRect } from '@/lib/image'

type Props = {
  image: HTMLImageElement
  onConfirm: (blob: Blob) => void
  onCancel: () => void
}

const FRAME = 300 // px, the visible square crop window
const MAX_ZOOM = 4

/**
 * Pan + zoom avatar cropper. The image is drawn at base scale (cover the frame) × zoom,
 * centred plus a drag offset. Pointer events handle drag and two-finger pinch; a slider handles zoom.
 */
export function AvatarCropper({ image, onConfirm, onCancel }: Props) {
  const { t } = useTranslation('onboarding')
  const nw = image.naturalWidth
  const nh = image.naturalHeight
  const base = FRAME / Math.min(nw, nh)

  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ dist: number; zoom: number } | null>(null)
  const last = useRef<{ x: number; y: number } | null>(null)

  const scale = base * zoom
  const clamp = useCallback(
    (o: { x: number; y: number }, z = zoom) => {
      const s = base * z
      const maxX = Math.max(0, (nw * s - FRAME) / 2)
      const maxY = Math.max(0, (nh * s - FRAME) / 2)
      return { x: Math.min(maxX, Math.max(-maxX, o.x)), y: Math.min(maxY, Math.max(-maxY, o.y)) }
    },
    [base, nw, nh, zoom],
  )

  useEffect(() => {
    setOffset((o) => clamp(o))
  }, [zoom, clamp])

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom }
      last.current = null
    } else {
      last.current = { x: e.clientX, y: e.clientY }
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      setZoom(Math.min(MAX_ZOOM, Math.max(1, (gesture.current.zoom * dist) / gesture.current.dist)))
      return
    }
    if (last.current) {
      const dx = e.clientX - last.current.x
      const dy = e.clientY - last.current.y
      last.current = { x: e.clientX, y: e.clientY }
      setOffset((o) => clamp({ x: o.x + dx, y: o.y + dy }))
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    gesture.current = null
    const remaining = [...pointers.current.values()]
    last.current = remaining.length === 1 ? remaining[0]! : null
  }
  const onWheel = (e: React.WheelEvent) => {
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(1, z - e.deltaY * 0.002)))
  }

  const rect = useMemo<CropRect>(() => {
    const left = FRAME / 2 + offset.x - (nw * scale) / 2
    const top = FRAME / 2 + offset.y - (nh * scale) / 2
    return { sx: -left / scale, sy: -top / scale, sw: FRAME / scale, sh: FRAME / scale }
  }, [offset, scale, nw, nh])

  const confirm = async () => {
    setBusy(true)
    try {
      onConfirm(await cropToSquareJpeg(image, rect, 512))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t('crop.title')} className="fixed inset-0 z-50 flex flex-col bg-bg pt-safe pb-safe">
      <header className="flex items-center justify-between px-5 py-3">
        <h2 className="text-lg font-semibold">{t('crop.title')}</h2>
        <Button variant="ghost" size="icon" aria-label={t('crop.cancel')} onClick={onCancel}>
          <X className="size-5" aria-hidden />
        </Button>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <div
          className="relative touch-none select-none overflow-hidden rounded-[var(--radius-card)] bg-black"
          style={{ width: FRAME, height: FRAME }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          <img
            src={image.src}
            alt=""
            draggable={false}
            className="absolute left-1/2 top-1/2 max-w-none"
            style={{
              width: nw * scale,
              height: nh * scale,
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
            }}
          />
          {/* circular mask: everything outside the circle is dimmed */}
          <div
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{ boxShadow: '0 0 0 9999px oklch(13% 0.008 120 / 72%)' }}
          />
          <div className="pointer-events-none absolute inset-0 rounded-full border border-white/40" />
        </div>
        <p className="text-sm text-ink-faint">{t('crop.hint')}</p>

        <label className="flex w-full max-w-[300px] items-center gap-3 text-ink-faint">
          <span className="text-xs">1×</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label={t('crop.zoom')}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[#C8FF3D]"
          />
          <span className="text-xs">{MAX_ZOOM}×</span>
        </label>
      </div>

      <div className="flex gap-3 px-6 pb-5">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onCancel}>
          {t('crop.cancel')}
        </Button>
        <Button size="lg" className="flex-1 gap-2" onClick={() => void confirm()} disabled={busy}>
          <Check className="size-5" aria-hidden />
          {t('crop.done')}
        </Button>
      </div>
    </div>
  )
}
