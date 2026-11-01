import type { ComponentType, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * iOS inset grouped list: an optional section title (the one section-header style), one surface
 * container with hairline dividers, and an optional footnote under it. Rows are ListRow.
 */
export function GroupedList({
  title,
  footer,
  children,
  className,
  id,
}: {
  title?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}) {
  const titleId = id ? `${id}-title` : undefined
  return (
    <section className={cn('space-y-2', className)} aria-labelledby={title ? titleId : undefined}>
      {title && (
        <h2 id={titleId} className="section-title px-4">
          {title}
        </h2>
      )}
      <div className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">{children}</div>
      {footer && <p className="px-4 text-[12px] leading-snug text-ink-faint">{footer}</p>}
    </section>
  )
}

type IconType = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

type RowProps = {
  label: ReactNode
  /** second line under the label */
  hint?: ReactNode
  icon?: IconType
  /** right-aligned value (e.g. "On", "kg", an e-mail) */
  value?: ReactNode
  /** count pill before the chevron; hidden at 0 */
  badge?: number
  badgeTone?: 'volt' | 'danger'
  /** custom trailing control (switch, segmented control); replaces value and chevron */
  trailing?: ReactNode
  /** defaults to true for links and buttons */
  chevron?: boolean
  destructive?: boolean
  to?: string
  onClick?: () => void
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

/** One row of a GroupedList: link, button or static, min 44 px tall, optional value, badge and chevron. */
export function ListRow({
  label,
  hint,
  icon: Icon,
  value,
  badge,
  badgeTone = 'volt',
  trailing,
  chevron,
  destructive,
  to,
  onClick,
  disabled,
  className,
  'aria-label': ariaLabel,
}: RowProps) {
  const interactive = Boolean(to || onClick)
  const showChevron = !trailing && (chevron ?? interactive)
  const body = (
    <>
      {Icon && <Icon className={cn('size-5 shrink-0', destructive ? 'text-danger' : 'text-ink-muted')} aria-hidden />}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[15px]', destructive ? 'font-medium text-danger' : 'text-ink')}>{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-snug text-ink-faint">{hint}</span>}
      </span>
      {trailing}
      {!trailing && value !== undefined && value !== null && (
        <span className="max-w-[55%] shrink-0 truncate text-right text-[15px] text-ink-muted">{value}</span>
      )}
      {!trailing && badge !== undefined && badge > 0 && (
        <span
          className={cn(
            'tabular min-w-6 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-semibold',
            badgeTone === 'danger' ? 'bg-danger text-ink' : 'bg-volt text-volt-ink',
          )}
        >
          {badge}
        </span>
      )}
      {showChevron && <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />}
    </>
  )
  const base = cn(
    'flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left',
    interactive && 'transition-colors hover:bg-raised/60 active:bg-raised disabled:hover:bg-transparent',
    className,
  )
  if (to) {
    return (
      <Link to={to} className={base} aria-label={ariaLabel}>
        {body}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={base} aria-label={ariaLabel}>
        {body}
      </button>
    )
  }
  return (
    <div className={base} aria-label={ariaLabel}>
      {body}
    </div>
  )
}

/** Segmented control (2 to 4 options) for a ListRow's trailing slot or a full-width row. */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly { value: V; label: string }[]
  value: V
  onChange: (v: V) => void
  label: string
  className?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex rounded-[12px] bg-raised p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => !active && onChange(o.value)}
            className={cn(
              'h-10 min-w-11 flex-1 rounded-[10px] px-3 text-[14px] font-medium transition-colors',
              active ? 'hairline bg-surface text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
