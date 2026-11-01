import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, ImagePlus, Loader2, LockOpen, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { Sheet } from '@/components/ui/Sheet'
import { cn } from '@/lib/utils'
import { audienceReady } from '../audience'
import { usePublishPost } from '../hooks'
import { prepareImage } from '../image'
import { MAX_IMAGES, remainingSlots } from '../imageSize'
import { BODY_MAX } from '../payload'
import type { AudienceChoice, ComposerInitial, PostKind, PreparedImage } from '../types'
import { AudiencePicker } from './AudiencePicker'
import { MealBlock, ProgramBlock, WorkoutBlock } from './PayloadBlocks'

type Props = {
  open: boolean
  onClose: () => void
  initial?: ComposerInitial
  /** opened from a group page: that group is the preselected audience */
  groupId?: string | null
  onPublished?: (postId: string) => void
}

/** Mounted only while open, so every share starts from a clean draft and releases its images on close. */
export function ComposerSheet({ open, onClose, initial, groupId, onPublished }: Props) {
  if (!open) return null
  return <Composer onClose={onClose} initial={initial} groupId={groupId} onPublished={onPublished} />
}

type Slot = { id: string; url: string; image: PreparedImage | null; failed: boolean }

function Composer({ onClose, initial, groupId, onPublished }: Omit<Props, 'open'>) {
  const { t } = useTranslation('share')
  const publish = usePublishPost()
  const [body, setBody] = useState('')
  const [target, setTarget] = useState<AudienceChoice>(groupId ? { audience: 'group', groupId } : { audience: 'followers', groupId: null })
  const [slots, setSlots] = useState<Slot[]>([])
  const [hint, setHint] = useState<string | null>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const fixed = initial && 'image' in initial ? initial.image : null
  const fixedUrl = useMemo(() => (fixed ? URL.createObjectURL(fixed.blob) : null), [fixed])
  const urls = useRef(new Set<string>())

  // object URLs exist only while the composer is open (CLAUDE.md rule 5 for decrypted progress photos)
  useEffect(() => () => void (fixedUrl && URL.revokeObjectURL(fixedUrl)), [fixedUrl])
  useEffect(() => {
    const set = urls.current
    return () => set.forEach((u) => URL.revokeObjectURL(u))
  }, [])

  const kind: PostKind = initial ? initial.kind : slots.length ? 'photo' : 'text'
  const pickerMax = !initial || initial.kind === 'photo' ? MAX_IMAGES : initial.kind === 'meal' ? 1 : 0
  const free = remainingSlots(slots.length, pickerMax)
  const ready = slots.flatMap((s) => (s.image ? [s.image] : []))
  const busy = slots.some((s) => !s.image && !s.failed)

  const addFiles = async (files: File[]) => {
    const take = files.slice(0, free)
    const added = take.map((f) => {
      const url = URL.createObjectURL(f)
      urls.current.add(url)
      return { slot: { id: crypto.randomUUID(), url, image: null, failed: false } as Slot, file: f }
    })
    setSlots((s) => [...s, ...added.map((a) => a.slot)])
    for (const { slot, file } of added) {
      try {
        const image = await prepareImage(file)
        setSlots((s) => s.map((x) => (x.id === slot.id ? { ...x, image } : x)))
      } catch {
        setSlots((s) => s.map((x) => (x.id === slot.id ? { ...x, failed: true } : x)))
      }
    }
  }

  const remove = (id: string) =>
    setSlots((s) => {
      const gone = s.find((x) => x.id === id)
      if (gone) {
        URL.revokeObjectURL(gone.url)
        urls.current.delete(gone.url)
      }
      return s.filter((x) => x.id !== id)
    })

  const submit = () => {
    const images = fixed ? [fixed] : ready
    if (kind === 'text' && !body.trim()) return setHint(t('composer.needText'))
    if (kind === 'photo' && images.length === 0) return setHint(t('composer.needPhoto'))
    setHint(null)
    const payload = initial && 'payload' in initial ? initial.payload : {}
    publish.mutate(
      { kind, body, payload, target, images },
      {
        onSuccess: (id) => {
          onPublished?.(id)
          onClose()
        },
      },
    )
  }

  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (files.length) void addFiles(files)
  }

  return (
    <Sheet open label={t(`composer.titles.${kind}`)} closeLabel={t('composer.close')} onClose={onClose} className="pt-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="display text-[24px]">{t(`composer.titles.${initial?.kind ?? (slots.length ? 'photo' : 'text')}`)}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('composer.close')}
          className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      <div className="mt-4 space-y-5">
        <label className="block">
          <span className="sr-only">{t('composer.body')}</span>
          <textarea
            value={body}
            maxLength={BODY_MAX}
            rows={initial && initial.kind !== 'photo' ? 2 : 4}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('composer.placeholder')}
            className="hairline block w-full resize-none rounded-[var(--radius-input)] bg-bg px-3.5 py-3 text-[16px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-volt"
          />
          <span className={cn('tabular mt-1 block text-right text-[11px]', body.length > BODY_MAX - 50 ? 'text-ink' : 'text-ink-faint')}>
            {t('composer.count', { count: body.length, max: BODY_MAX })}
          </span>
        </label>

        {initial && 'payload' in initial && (
          <div>
            {initial.kind === 'workout' && <WorkoutBlock payload={initial.payload} />}
            {initial.kind === 'program' && <ProgramBlock payload={initial.payload} canCopy={false} />}
            {initial.kind === 'meal' && <MealBlock payload={initial.payload} />}
          </div>
        )}

        {fixed && fixedUrl && (
          <figure>
            <img src={fixedUrl} alt={t('composer.previewAlt')} className="hairline max-h-[42dvh] w-full rounded-[var(--radius-card)] bg-raised object-contain" />
            <figcaption className="mt-2 flex items-center gap-2 text-[12px] leading-snug text-ink-muted">
              <LockOpen className="size-3.5 shrink-0" aria-hidden />
              {t('composer.unencrypted')}
            </figcaption>
          </figure>
        )}

        {pickerMax > 0 && (
          <div>
            <input ref={galleryRef} type="file" accept="image/*" multiple={pickerMax > 1} className="sr-only" tabIndex={-1} onChange={pickFiles} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={pickFiles} />
            <div className="grid grid-cols-4 gap-2">
              {slots.map((s, i) => (
                <div key={s.id} className="relative aspect-square overflow-hidden rounded-[var(--radius-input)] bg-raised">
                  <img src={s.url} alt="" className={cn('size-full object-cover', !s.image && 'opacity-50')} />
                  {!s.image && !s.failed && (
                    <Loader2 className="absolute inset-0 m-auto size-5 animate-spin text-ink" aria-label={t('composer.preparing')} />
                  )}
                  <button
                    type="button"
                    onClick={() => remove(s.id)}
                    aria-label={t('composer.removePhoto', { n: i + 1 })}
                    className="absolute right-0 top-0 flex size-11 items-start justify-end p-1.5"
                  >
                    <span className="flex size-6 items-center justify-center rounded-full bg-bg/80 text-ink">
                      <X className="size-3.5" aria-hidden />
                    </span>
                  </button>
                </div>
              ))}
              {free > 0 && (
                <>
                  <PickTile icon={Camera} label={t('composer.camera')} onClick={() => cameraRef.current?.click()} />
                  <PickTile icon={ImagePlus} label={t('composer.gallery')} onClick={() => galleryRef.current?.click()} />
                </>
              )}
            </div>
            {slots.some((s) => s.failed) && <p className="mt-2 text-[12px] text-danger">{t('composer.photoFailed')}</p>}
            <p className="mt-2 text-[12px] leading-snug text-ink-faint">{t('composer.photosHint', { count: pickerMax })}</p>
          </div>
        )}

        <AudiencePicker value={target} onChange={setTarget} />
      </div>

      {hint && <p className="mt-4 text-[13px] text-ink">{hint}</p>}
      <ErrorNote error={publish.error} className="mt-4" />
      <div className="sticky bottom-0 -mx-5 mt-5 bg-surface px-5 pb-5 pt-2">
        <Button size="lg" className="w-full" disabled={publish.isPending || busy || !audienceReady(target)} onClick={submit}>
          {publish.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
          {publish.isPending ? t('composer.publishing') : t('composer.publish')}
        </Button>
      </div>
    </Sheet>
  )
}

function PickTile({ icon: Icon, label, onClick }: { icon: typeof Camera; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hairline flex aspect-square flex-col items-center justify-center gap-1.5 rounded-[var(--radius-input)] bg-bg text-[12px] font-medium text-ink-muted transition-colors hover:text-ink"
    >
      <Icon className="size-5" aria-hidden />
      {label}
    </button>
  )
}
