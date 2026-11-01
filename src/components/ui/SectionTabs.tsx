import { cn } from '@/lib/utils'

/**
 * Section switch for NAVIGATION between sections or lists of a screen: plain words split by hairline
 * bars, no box. The active word lifts a little and sits on a volt dot; the others stay faint. To pick a
 * VALUE inside a form or a settings row use `Segmented` (GroupedList) instead.
 */
export function SectionTabs<T extends string>({
  label,
  options,
  value,
  onChange,
  labelOf,
  className,
  fit,
}: {
  label: string
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  labelOf: (v: T) => string
  className?: string
  /** columns share the width by label length (long labels, e.g. three Turkish words) instead of equally */
  fit?: boolean
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('mb-5 flex items-center', className)}>
      {options.map((v, i) => {
        const active = v === value
        return (
          <div key={v} className={cn('flex items-center', fit ? 'flex-auto' : 'flex-1')}>
            {i > 0 && <span aria-hidden className="h-4 w-px bg-line-strong" />}
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(v)}
              className={cn('relative flex h-12 flex-1 flex-col items-center justify-center', fit && 'whitespace-nowrap px-3')}
            >
              <span
                className={cn(
                  'text-[15px] font-semibold transition-[color,transform] duration-200 ease-out motion-reduce:transition-none',
                  active ? '-translate-y-1 text-ink' : 'text-ink-faint hover:text-ink-muted',
                )}
              >
                {labelOf(v)}
              </span>
              <span
                aria-hidden
                className={cn(
                  'absolute bottom-2 size-1.5 rounded-full bg-volt transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none',
                  active ? 'scale-100 opacity-100' : 'scale-0 opacity-0',
                )}
              />
            </button>
          </div>
        )
      })}
    </div>
  )
}
