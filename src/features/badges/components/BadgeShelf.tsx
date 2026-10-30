import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { Sheet } from '@/components/ui/Sheet'
import { cn } from '@/lib/utils'
import { useBadgeCounts, useBadgeDate, useMyBadges } from '../hooks'
import { BADGES, shelfItems, type ShelfItem } from '../logic'
import { BadgeMedal } from './BadgeMedal'

/**
 * Own badge shelf (Profile). Point of view: a trophy shelf, not a settings list. Four to a row, earned
 * medals in volt, locked ones quiet with a progress ring and "4/7" underneath. Tap for the details.
 */
export function BadgeShelf() {
  const { t } = useTranslation('badges')
  const mine = useMyBadges()
  const counts = useBadgeCounts()
  const [open, setOpen] = useState<ShelfItem | null>(null)
  const items = shelfItems(mine.data ?? [], counts.data)
  const earned = items.filter((i) => i.earnedAt).length

  return (
    <section className="space-y-2" aria-labelledby="badges-title">
      <div className="flex items-baseline justify-between">
        <h2 id="badges-title" className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          {t('title')}
        </h2>
        {mine.data && (
          <span className="tabular text-[12px] text-ink-faint">
            {t('count', { earned, total: BADGES.length })}
          </span>
        )}
      </div>
      <ErrorNote error={mine.error} />
      <div className="hairline rounded-xl bg-surface px-2 py-4">
        {mine.isLoading ? <ShelfSkeleton /> : <BadgeGrid items={items} onSelect={setOpen} />}
      </div>
      <BadgeDetailSheet item={open} onClose={() => setOpen(null)} />
    </section>
  )
}

/** Medal grid shared by the own shelf and the public profile sheet. */
export function BadgeGrid({
  items,
  onSelect,
  size = 52,
}: {
  items: ShelfItem[]
  onSelect?: (item: ShelfItem) => void
  size?: number
}) {
  const { t } = useTranslation('badges')
  const date = useBadgeDate()
  return (
    <ul className="grid grid-cols-4 gap-x-1 gap-y-4">
      {items.map((item) => {
        const name = t(`items.${item.code}.name`)
        const caption = item.earnedAt
          ? date(item.earnedAt)
          : item.progress
            ? `${item.progress.value}/${item.progress.threshold}`
            : ''
        const label = item.earnedAt
          ? `${name}, ${t('earnedOn', { date: date(item.earnedAt, 'd MMMM yyyy') })}`
          : `${name}, ${t('locked')}${item.progress ? ` ${caption}` : ''}`
        const body = (
          <>
            <BadgeMedal
              code={item.code}
              earned={Boolean(item.earnedAt)}
              ratio={item.progress?.ratio}
              size={size}
            />
            <span
              className={cn(
                'mt-2 line-clamp-2 text-[12px] font-medium leading-tight',
                item.earnedAt ? 'text-ink' : 'text-ink-muted',
              )}
            >
              {name}
            </span>
            {caption && (
              <span className="tabular mt-0.5 text-[11px] leading-tight text-ink-faint">{caption}</span>
            )}
          </>
        )
        return (
          <li key={item.code} className="flex">
            {onSelect ? (
              <button
                type="button"
                aria-label={label}
                onClick={() => onSelect(item)}
                className="flex w-full flex-col items-center rounded-[var(--radius-input)] px-1 py-1 text-center transition-colors hover:bg-raised/60"
              >
                {body}
              </button>
            ) : (
              <div
                aria-label={label}
                role="img"
                className="flex w-full flex-col items-center px-1 py-1 text-center"
              >
                {body}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function BadgeDetailSheet({ item, onClose }: { item: ShelfItem | null; onClose: () => void }) {
  const { t } = useTranslation('badges')
  const date = useBadgeDate()
  const metric = BADGES.find((b) => b.code === item?.code)?.metric
  return (
    <Sheet
      open={item !== null}
      label={item ? t(`items.${item.code}.name`) : ''}
      closeLabel={t('close')}
      onClose={onClose}
    >
      {item && (
        <div className="flex flex-col items-center pb-5 text-center">
          <BadgeMedal
            code={item.code}
            earned={Boolean(item.earnedAt)}
            ratio={item.progress?.ratio}
            size={88}
          />
          <p
            className={cn(
              'mt-5 text-[11px] font-semibold uppercase tracking-[0.12em]',
              item.earnedAt ? 'text-volt' : 'text-ink-faint',
            )}
          >
            {item.earnedAt ? t('earnedOn', { date: date(item.earnedAt, 'd MMMM yyyy') }) : t('locked')}
          </p>
          <h2 className="display mt-2 text-[28px]">{t(`items.${item.code}.name`)}</h2>
          <p className="mt-2 max-w-[32ch] text-[15px] leading-relaxed text-ink-muted">
            {t(`items.${item.code}.desc`)}
          </p>
          {item.progress && metric && (
            <div className="mt-6 w-full max-w-[280px]">
              <div className="h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
                <div
                  className="h-full rounded-full bg-ink-muted"
                  style={{ width: `${item.progress.ratio * 100}%` }}
                />
              </div>
              <p className="tabular mt-2 text-[13px] text-ink-muted">
                {t(`progress.${metric}`, { value: item.progress.value, threshold: item.progress.threshold })}
              </p>
            </div>
          )}
          <Button variant="secondary" size="lg" className="mt-8 w-full" onClick={onClose}>
            {t('close')}
          </Button>
        </div>
      )}
    </Sheet>
  )
}

function ShelfSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-y-4" aria-hidden>
      {BADGES.map((b) => (
        <div key={b.code} className="flex flex-col items-center gap-2">
          <span className="size-[52px] animate-pulse rounded-full bg-raised motion-reduce:animate-none" />
          <span className="h-2.5 w-12 rounded bg-raised" />
        </div>
      ))}
    </div>
  )
}
