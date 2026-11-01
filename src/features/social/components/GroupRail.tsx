import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { KeyRound, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMyGroups } from '../hooks'
import { groupMonogram } from '../logic'
import type { MyGroup } from '../schema'
import { GroupCreateSheet } from './GroupSheets'

const STATUS_ORDER: Record<string, number> = { invited: 0, active: 1, pending: 2 }

/**
 * "My groups" rail on the Community home: story-style circles that scroll sideways. Invitations come
 * first and carry the volt ring (the only accent here); sent requests sit at the end, dimmed.
 */
export function GroupRail() {
  const { t, i18n } = useTranslation('social')
  const mine = useMyGroups()
  const [creating, setCreating] = useState(false)
  const groups = [...(mine.data ?? [])].sort(
    (a, b) => (STATUS_ORDER[a.status ?? ''] ?? 3) - (STATUS_ORDER[b.status ?? ''] ?? 3),
  )
  const empty = !mine.isLoading && groups.length === 0

  return (
    <section aria-labelledby="social-group-rail" className="mb-5">
      <h2 id="social-group-rail" className="eyebrow mb-3">
        {t('rail.title')}
      </h2>
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [contain:inline-size] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <li>
          <RailItem label={t('rail.create')} onClick={() => setCreating(true)}>
            <Circle className="hairline border-line-strong bg-surface text-ink-muted">
              <Plus className="size-6" strokeWidth={2} aria-hidden />
            </Circle>
          </RailItem>
        </li>
        {empty && (
          <li>
            <RailItem label={t('rail.joinByCode')} to="/social/join">
              <Circle className="hairline border-line-strong bg-surface text-ink-muted">
                <KeyRound className="size-[22px]" strokeWidth={1.75} aria-hidden />
              </Circle>
            </RailItem>
          </li>
        )}
        {mine.isLoading &&
          Array.from({ length: 4 }, (_, i) => (
            <li key={i} aria-hidden className="flex w-[72px] shrink-0 flex-col items-center gap-2">
              <span className="size-16 rounded-full bg-raised motion-safe:animate-pulse" />
              <span className="h-2.5 w-12 rounded-full bg-raised motion-safe:animate-pulse" />
            </li>
          ))}
        {groups.map((g) => (
          <li key={g.group_id}>
            <GroupItem group={g} locale={i18n.language} />
          </li>
        ))}
      </ul>
      <GroupCreateSheet open={creating} onClose={() => setCreating(false)} />
    </section>
  )
}

function GroupItem({ group: g, locale }: { group: MyGroup; locale: string }) {
  const { t } = useTranslation('social')
  const name = g.name ?? ''
  const invited = g.status === 'invited'
  const pending = g.status === 'pending'
  return (
    <RailItem
      label={name}
      to={`/social/g/${g.group_id}`}
      ariaLabel={invited ? t('rail.invited', { name }) : pending ? t('rail.pending', { name }) : undefined}
      dim={pending}
    >
      <Circle
        className={cn(
          'bg-raised',
          invited && 'ring-2 ring-volt ring-offset-2 ring-offset-bg',
          pending ? 'text-ink-faint' : 'text-ink',
        )}
      >
        <span className="display text-[20px] leading-none">{groupMonogram(name, locale)}</span>
      </Circle>
    </RailItem>
  )
}

function Circle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn('flex size-16 items-center justify-center rounded-full', className)}>{children}</span>
  )
}

/** 72 px column: 64 px circle (the touch target) and a one-line caption. */
function RailItem({
  label,
  ariaLabel,
  to,
  onClick,
  dim,
  children,
}: {
  label: string
  ariaLabel?: string
  to?: string
  onClick?: () => void
  dim?: boolean
  children: ReactNode
}) {
  const cls =
    'group flex w-[72px] shrink-0 flex-col items-center gap-1.5 rounded-[var(--radius-input)] pt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt'
  const body = (
    <>
      <span className="transition-transform duration-150 ease-out group-active:scale-95 motion-reduce:transition-none">
        {children}
      </span>
      <span
        className={cn(
          'w-full truncate text-center text-[12px] leading-4',
          dim ? 'text-ink-faint' : 'text-ink-muted group-hover:text-ink',
        )}
      >
        {label}
      </span>
    </>
  )
  return to ? (
    <Link to={to} aria-label={ariaLabel} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} aria-label={ariaLabel} className={cls}>
      {body}
    </button>
  )
}
