import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { Camera, ImageOff, Loader2, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { useUnits } from '@/features/settings/useUnits'
import { toLocalDateISO } from '@/lib/dates'
import { parseWeightInput } from '@/lib/units'
import { cn } from '@/lib/utils'
import { useAddPhoto, useDecryptedMeta, useDecryptedUrl, useDeletePhoto } from '../hooks'
import { POSES, type PhotoRow, type Pose } from '../types'

function useLocale() {
  const { i18n } = useTranslation()
  return i18n.resolvedLanguage === 'en' ? enUS : tr
}

/** Thumbnail decrypted in memory; a quiet placeholder while it decrypts. */
export function Thumb({ photo, cryptoKey, onOpen }: { photo: PhotoRow; cryptoKey: CryptoKey; onOpen: () => void }) {
  const { t } = useTranslation('photos')
  const locale = useLocale()
  const { url, error } = useDecryptedUrl(photo, 'thumb', cryptoKey)
  const label = `${format(parseISO(photo.taken_on), 'd MMM yyyy', { locale })} · ${t(`poses.${photo.pose}`)}`
  return (
    <button type="button" onClick={onOpen} aria-label={label} className="group relative aspect-[3/4] overflow-hidden rounded-[var(--radius-input)] bg-raised">
      {url ? (
        <img src={url} alt="" className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.02]" />
      ) : error ? (
        <ImageOff className="absolute inset-0 m-auto size-5 text-ink-faint" aria-hidden />
      ) : (
        <span className="absolute inset-0 animate-pulse bg-raised" aria-hidden />
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5 text-left text-[11px] font-semibold text-white">
        {format(parseISO(photo.taken_on), 'd MMM', { locale })}
        <span className="ml-1 font-normal opacity-80">{t(`poses.${photo.pose}`)}</span>
      </span>
    </button>
  )
}

/** Timeline by month, newest first. */
export function Timeline({ photos, cryptoKey, onOpen }: { photos: PhotoRow[]; cryptoKey: CryptoKey; onOpen: (p: PhotoRow) => void }) {
  const locale = useLocale()
  const months = useMemo(() => {
    const m = new Map<string, PhotoRow[]>()
    for (const p of photos) {
      const k = p.taken_on.slice(0, 7)
      m.set(k, [...(m.get(k) ?? []), p])
    }
    return [...m.entries()]
  }, [photos])
  return (
    <div className="space-y-6">
      {months.map(([month, list]) => {
        const label = format(parseISO(`${month}-01`), 'LLLL yyyy', { locale })
        return (
        <section key={month} aria-label={label}>
          <h3 className="eyebrow mb-2 capitalize">{label}</h3>
          <div className="grid grid-cols-3 gap-1.5">
            {list.map((p) => (
              <Thumb key={p.id} photo={p} cryptoKey={cryptoKey} onOpen={() => onOpen(p)} />
            ))}
          </div>
        </section>
        )
      })}
    </div>
  )
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useTranslation('photos')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-bg pt-safe pb-safe">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        <Button variant="ghost" size="icon" aria-label={t('actions.close')} onClick={onClose}>
          <X className="size-5" aria-hidden />
        </Button>
      </header>
      <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

function PoseChips({ value, onChange }: { value: Pose; onChange: (p: Pose) => void }) {
  const { t } = useTranslation('photos')
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {POSES.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={value === p}
          onClick={() => onChange(p)}
          className={cn('h-11 rounded-full text-[13px] font-semibold transition-colors', value === p ? 'bg-ink text-bg' : 'hairline text-ink-muted hover:text-ink')}
        >
          {t(`poses.${p}`)}
        </button>
      ))}
    </div>
  )
}

/** Pick or shoot, choose pose/date, optional weight and note; encrypted on the device before upload. */
export function AddPhotoSheet({ cryptoKey, onClose }: { cryptoKey: CryptoKey; onClose: () => void }) {
  const { t } = useTranslation('photos')
  const u = useUnits()
  const add = useAddPhoto(cryptoKey)
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [pose, setPose] = useState<Pose>('front')
  const [day, setDay] = useState(toLocalDateISO())
  const [weight, setWeight] = useState('')
  const [note, setNote] = useState('')
  // in-memory preview of the original, revoked when replaced or closed
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])
  // typed in the user's unit, kept in kg inside the encrypted meta
  const kg = weight.trim() ? parseWeightInput(weight, u.weight, 'body') : null
  const weightInvalid = weight.trim() !== '' && (kg == null || !(kg > 20 && kg < 400))

  return (
    <Sheet title={t('add.title')} onClose={onClose}>
      <div className="space-y-5 px-4 py-5">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            e.target.value = ''
            if (f) setFile(f)
          }}
        />
        {preview ? (
          <div className="flex items-end gap-3">
            <img src={preview} alt={t('add.previewAlt')} className="hairline aspect-[3/4] w-32 rounded-[var(--radius-input)] object-cover" />
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>
              <Camera className="size-4" aria-hidden />
              {t('add.change')}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="hairline flex h-40 w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] bg-surface text-[15px] font-medium text-ink-muted hover:text-ink"
          >
            <Camera className="size-7" aria-hidden />
            {t('add.pick')}
          </button>
        )}
        <fieldset>
          <legend className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">{t('add.pose')}</legend>
          <PoseChips value={pose} onChange={setPose} />
        </fieldset>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">{t('add.date')}</span>
            <input
              type="date"
              value={day}
              max={toLocalDateISO()}
              onChange={(e) => e.target.value && setDay(e.target.value)}
              className="tabular hairline h-12 w-full rounded-[var(--radius-input)] bg-surface px-3 text-[16px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-volt"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">{t('add.weight', { unit: u.weightLabel })}</span>
            <input
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className="tabular hairline h-12 w-full rounded-[var(--radius-input)] bg-surface px-3 text-[16px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-volt"
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">{t('add.note')}</span>
          <input
            value={note}
            maxLength={200}
            placeholder={t('add.notePlaceholder')}
            onChange={(e) => setNote(e.target.value)}
            className="hairline h-12 w-full rounded-[var(--radius-input)] bg-surface px-3 text-[16px] text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-volt"
          />
        </label>
        <p className="text-[12px] leading-snug text-ink-faint">{t('add.privacy')}</p>
        <ErrorNote error={add.error} />
        <Button
          size="lg"
          className="w-full"
          disabled={!file || add.isPending || weightInvalid}
          onClick={() => file && add.mutate({ file, takenOn: day, pose, meta: { note: note.trim() || undefined, weight: kg } }, { onSuccess: onClose })}
        >
          {add.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
          {add.isPending ? t('add.working') : t('add.submit')}
        </Button>
      </div>
    </Sheet>
  )
}

/** Full-size photo, decrypted only while open. */
export function PhotoViewer({ photo, cryptoKey, onClose }: { photo: PhotoRow; cryptoKey: CryptoKey; onClose: () => void }) {
  const { t } = useTranslation('photos')
  const u = useUnits()
  const locale = useLocale()
  const { url, error } = useDecryptedUrl(photo, 'image', cryptoKey)
  const meta = useDecryptedMeta(photo, cryptoKey)
  const del = useDeletePhoto()
  const [confirm, setConfirm] = useState(false)
  return (
    <Sheet title={t('viewer.title')} onClose={onClose}>
      <div className="space-y-4 px-4 py-4">
        <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-[var(--radius-card)] bg-raised">
          {url ? (
            <img src={url} alt={`${format(parseISO(photo.taken_on), 'd MMMM yyyy', { locale })}, ${t(`poses.${photo.pose}`)}`} className="size-full object-contain" />
          ) : error ? (
            <p className="text-[13px] text-ink-muted">{t('gallery.decryptFail')}</p>
          ) : (
            <p className="flex items-center gap-2 text-[13px] text-ink-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t('viewer.loading')}
            </p>
          )}
        </div>
        <div>
          <p className="display text-[22px]">{format(parseISO(photo.taken_on), 'd MMMM yyyy', { locale })}</p>
          <p className="mt-1 text-[14px] text-ink-muted">
            {t(`poses.${photo.pose}`)}
            {meta.data?.weight != null && <> · {t('viewer.weight', { weight: `${u.body(meta.data.weight)} ${u.weightLabel}` })}</>}
          </p>
          {meta.data?.note && <p className="mt-2 text-[14px]">{meta.data.note}</p>}
        </div>
        <ErrorNote error={del.error} />
        <Button
          variant="ghost"
          className={cn('w-full', confirm && 'text-danger')}
          disabled={del.isPending}
          onClick={() => (confirm ? del.mutate(photo, { onSuccess: onClose }) : setConfirm(true))}
        >
          {del.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
          {confirm ? t('viewer.confirmDelete') : t('viewer.delete')}
        </Button>
      </div>
    </Sheet>
  )
}

/** Same pose, two dates, one frame: drag to reveal before vs after. */
export function CompareSheet({ photos, cryptoKey, onClose }: { photos: PhotoRow[]; cryptoKey: CryptoKey; onClose: () => void }) {
  const { t } = useTranslation('photos')
  const locale = useLocale()
  const posesWithTwo = POSES.filter((p) => photos.filter((x) => x.pose === p).length >= 2)
  const [pose, setPose] = useState<Pose>(posesWithTwo[0] ?? 'front')
  const list = useMemo(() => photos.filter((p) => p.pose === pose).sort((a, b) => a.taken_on.localeCompare(b.taken_on)), [photos, pose])
  const [beforeId, setBeforeId] = useState<string | null>(null)
  const [afterId, setAfterId] = useState<string | null>(null)
  const before = list.find((p) => p.id === beforeId) ?? list[0] ?? null
  const after = list.find((p) => p.id === afterId) ?? list[list.length - 1] ?? null
  const a = useDecryptedUrl(before, 'image', cryptoKey)
  const b = useDecryptedUrl(after, 'image', cryptoKey)
  const [pos, setPos] = useState(50)
  const label = (p: PhotoRow) => format(parseISO(p.taken_on), 'd MMM yyyy', { locale })

  return (
    <Sheet title={t('compare.title')} onClose={onClose}>
      <div className="space-y-4 px-4 py-4">
        <fieldset>
          <legend className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">{t('compare.pose')}</legend>
          <PoseChips
            value={pose}
            onChange={(p) => {
              setPose(p)
              setBeforeId(null)
              setAfterId(null)
            }}
          />
        </fieldset>
        {list.length < 2 || !before || !after ? (
          <p className="text-[14px] text-ink-muted">{t('compare.needTwo')}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['before', before, setBeforeId],
                  ['after', after, setAfterId],
                ] as const
              ).map(([k, sel, set]) => (
                <label key={k} className="block">
                  <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">{t(`compare.${k}`)}</span>
                  <select
                    value={sel.id}
                    onChange={(e) => set(e.target.value)}
                    className="hairline h-12 w-full rounded-[var(--radius-input)] bg-surface px-2 text-[16px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-volt"
                  >
                    {list.map((p) => (
                      <option key={p.id} value={p.id}>
                        {label(p)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="relative aspect-[3/4] select-none overflow-hidden rounded-[var(--radius-card)] bg-raised">
              {b.url && <img src={b.url} alt={`${t('compare.after')}: ${label(after)}`} className="absolute inset-0 size-full object-cover" />}
              {a.url && (
                <img
                  src={a.url}
                  alt={`${t('compare.before')}: ${label(before)}`}
                  className="absolute inset-0 size-full object-cover"
                  style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
                />
              )}
              {(!a.url || !b.url) && <Loader2 className="absolute inset-0 m-auto size-6 animate-spin text-ink-faint" aria-hidden />}
              <div aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" style={{ left: `${pos}%` }} />
              <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">{label(before)}</span>
              <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">{label(after)}</span>
            </div>
            <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label={t('compare.slider')} className="w-full accent-[var(--color-volt)]" />
            <p className="text-center text-[13px] text-ink-muted">{t('compare.days', { count: Math.abs(differenceInCalendarDays(parseISO(after.taken_on), parseISO(before.taken_on))) })}</p>
          </>
        )}
      </div>
    </Sheet>
  )
}
