import { useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { format, parseISO } from 'date-fns'
import { Check, ClipboardList, CopyPlus, Dumbbell, ImageOff, Loader2, Utensils, type LucideIcon } from 'lucide-react'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { useUnits } from '@/features/settings/useUnits'
import { cn } from '@/lib/utils'
import { formatClock } from '@/features/workouts/logic'
import { useCopyProgram, useDateFnsLocale } from '../hooks'
import { useSignedUrl, useStableSrc } from '../mediaCache'
import { useSharePreview } from '../previewContext'
import type { MealPayload, MediaRef, ProgramPayload, WorkoutPayload } from '../types'
import { ImageViewer } from './ImageViewer'

/** One hairline-bordered attachment (like a link preview): a quiet source line, then the content. */
function Attachment({ icon: Icon, source, children }: { icon: LucideIcon; source: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <p className="flex items-center gap-1.5 px-3 pt-2.5 text-[13px] text-ink-muted">
        <Icon className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
        <span className="truncate">{source}</span>
      </p>
      {children}
    </div>
  )
}

/** Stats in one row: value over label, tabular. */
function StatRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className={cn('grid gap-2 px-3 pb-2.5 pt-1.5', items.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}>
      {items.map((s) => (
        <div key={s.label} className="flex min-w-0 flex-col-reverse">
          <dt className="truncate text-[12px] text-ink-faint">{s.label}</dt>
          <dd className="display tabular truncate text-[19px] leading-tight text-ink">{s.value}</dd>
        </div>
      ))}
    </dl>
  )
}

const TOP_EXERCISES = 3

/** Strava-style summary: duration · volume · sets, then the top exercises with their best set. */
export function WorkoutBlock({ payload }: { payload: WorkoutPayload }) {
  const { t } = useTranslation('share')
  const u = useUnits()
  const locale = useDateFnsLocale()
  const top = payload.exercises.slice(0, TOP_EXERCISES)
  const rest = payload.exercises.length - top.length
  return (
    <Attachment icon={Dumbbell} source={`${t('kinds.workout')} · ${format(parseISO(payload.date), 'd MMM', { locale })}`}>
      <StatRow
        items={[
          { label: t('workout.duration'), value: formatClock(payload.duration_sec) },
          { label: t('workout.volume', { unit: u.weightLabel }), value: u.volume(payload.volume_kg) },
          { label: t('workout.sets'), value: String(payload.sets) },
        ]}
      />
      {top.length > 0 && (
        <ul className="border-t border-line px-3 py-2">
          {top.map((e, i) => (
            <li key={`${e.name}-${i}`} className="flex items-baseline gap-3 py-0.5 text-[14px] leading-5">
              <span className="min-w-0 flex-1 truncate text-ink-muted">{e.name}</span>
              {e.best && (
                <span className="tabular shrink-0 text-ink">
                  {e.best.weight_kg != null ? `${u.load(e.best.weight_kg)} ${u.weightLabel} × ${e.best.reps}` : t('workout.reps', { count: e.best.reps })}
                </span>
              )}
            </li>
          ))}
          {rest > 0 && <li className="pt-0.5 text-[13px] text-ink-faint">{t('workout.more', { count: rest })}</li>}
        </ul>
      )}
    </Attachment>
  )
}

const TOP_DAYS = 3

/** Program preview: name and size, one line per day; viewers can copy it (catalog exercises only). */
export function ProgramBlock({ payload, canCopy }: { payload: ProgramPayload; canCopy: boolean }) {
  const { t } = useTranslation('share')
  const copy = useCopyProgram()
  const days = payload.days.slice(0, TOP_DAYS)
  const count = payload.days.reduce((n, d) => n + d.exercises.length, 0)
  const result = copy.data
  return (
    <Attachment icon={ClipboardList} source={t('kinds.program')}>
      <div className="px-3 pb-2.5 pt-1">
        <p className="truncate text-[16px] font-semibold leading-snug text-ink">{payload.name}</p>
        <p className="tabular text-[13px] text-ink-faint">
          {t('program.days', { count: payload.days.length })} · {t('program.exercises', { count })}
        </p>
      </div>
      <ol className="border-t border-line px-3 py-2">
        {days.map((day, i) => (
          <li key={i} className="flex items-baseline gap-2.5 py-0.5 text-[14px] leading-5">
            <span aria-hidden className="tabular w-5 shrink-0 text-[12px] font-semibold text-ink-faint">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold text-ink">{day.name}</span>
              <span className="text-ink-muted"> · {day.exercises.map((e) => `${e.name} ${e.sets}×${e.reps_low === e.reps_high ? e.reps_low : `${e.reps_low}–${e.reps_high}`}`).join(', ')}</span>
            </span>
          </li>
        ))}
        {payload.days.length > TOP_DAYS && <li className="pl-[30px] pt-0.5 text-[13px] text-ink-faint">{t('program.moreDays', { count: payload.days.length - TOP_DAYS })}</li>}
      </ol>
      {canCopy && (
        <div className="border-t border-line">
          {result ? (
            <div className="space-y-1 px-3 py-2.5">
              <p className="flex items-start gap-2 text-[13px] leading-snug text-ink">
                <Check className="mt-0.5 size-4 shrink-0 text-volt" aria-hidden />
                {result.created > 0 ? t('program.copied', { count: result.created }) : t('program.nothing')}
              </p>
              {result.skipped.length > 0 && <p className="text-[12px] leading-snug text-ink-faint">{t('program.skipped', { names: result.skipped.join(', ') })}</p>}
            </div>
          ) : (
            <button
              type="button"
              disabled={copy.isPending}
              onClick={() => copy.mutate(payload)}
              className="flex h-11 w-full items-center gap-2 px-3 text-[14px] font-semibold text-ink transition-colors hover:bg-raised/60 disabled:opacity-60"
            >
              {copy.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CopyPlus className="size-4 text-ink-muted" aria-hidden />}
              {t('program.copy')}
            </button>
          )}
          <ErrorNote error={copy.error} className="px-3 pb-2.5" />
        </div>
      )}
    </Attachment>
  )
}

/** Meal: calories and the three macros in one row. */
export function MealBlock({ payload }: { payload: MealPayload }) {
  const { t, i18n } = useTranslation('share')
  const nf = new Intl.NumberFormat(i18n.resolvedLanguage === 'en' ? 'en' : 'tr', { maximumFractionDigits: 1 })
  return (
    <Attachment icon={Utensils} source={payload.name ? `${t('kinds.meal')} · ${payload.name}` : t('kinds.meal')}>
      <StatRow
        items={[
          { label: t('meal.kcal'), value: nf.format(payload.kcal) },
          { label: t('meal.protein'), value: t('meal.grams', { value: nf.format(payload.protein_g) }) },
          { label: t('meal.carb'), value: t('meal.grams', { value: nf.format(payload.carb_g) }) },
          { label: t('meal.fat'), value: t('meal.grams', { value: nf.format(payload.fat_g) }) },
        ]}
      />
    </Attachment>
  )
}

/**
 * Media inside the content column. One image keeps its shape (between 3:4 and 1.91:1, at most 520 px tall);
 * 2-4 images share a 16:9 frame in an X-style grid with 2 px gaps. Tap opens the full-screen viewer.
 */
export function MediaGrid({ media }: { media: MediaRef[] }) {
  const { t } = useTranslation('share')
  const [open, setOpen] = useState<number | null>(null)
  const sorted = [...media].sort((a, b) => a.position - b.position).slice(0, 4)
  if (!sorted.length) return null
  const total = sorted.length
  const tile = (m: MediaRef, i: number, className: string, style?: CSSProperties) => (
    <button
      key={m.path}
      type="button"
      onClick={() => setOpen(i)}
      aria-label={t('card.openMedia', { n: i + 1, total })}
      className={cn('block overflow-hidden bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-volt', className)}
      style={style}
    >
      <MediaImage media={m} n={i + 1} total={total} />
    </button>
  )
  const ratio = Math.min(1.91, Math.max(0.75, sorted[0].width / sorted[0].height))
  return (
    <>
      {total === 1 ? (
        tile(sorted[0], 0, 'max-h-[520px] w-full rounded-xl border border-line', { aspectRatio: String(ratio) })
      ) : (
        <div className={cn('grid aspect-[16/9] grid-cols-2 gap-0.5 overflow-hidden rounded-xl border border-line', total > 2 && 'grid-rows-2')}>
          {sorted.map((m, i) => tile(m, i, cn('size-full', total === 3 && i === 0 && 'row-span-2')))}
        </div>
      )}
      {open !== null && <ImageViewer media={sorted} start={open} onClose={() => setOpen(null)} />}
    </>
  )
}

export function MediaImage({ media, n, total }: { media: MediaRef; n: number; total: number }) {
  const { t } = useTranslation('share')
  const preview = useSharePreview()
  const { url, failed } = useSignedUrl(media.path, preview?.resolveMedia)
  const stable = useStableSrc(url)
  if (failed) {
    return (
      <span className="flex size-full items-center justify-center" role="img" aria-label={t('card.mediaFailed')}>
        <ImageOff className="size-5 text-ink-faint" aria-hidden />
      </span>
    )
  }
  if (!url) return <span className="block size-full animate-pulse bg-raised motion-reduce:animate-none" aria-hidden />
  return (
    <img
      src={stable.src ?? url}
      onLoad={stable.onLoad}
      alt={t('card.mediaAlt', { n, total })}
      width={media.width}
      height={media.height}
      loading="lazy"
      decoding="async"
      draggable={false}
      className="size-full object-cover"
    />
  )
}
