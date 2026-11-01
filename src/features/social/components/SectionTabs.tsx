import { cn } from '@/lib/utils'

/**
 * Section switch: plain words split by hairline bars, no box. The active word lifts a little and sits on
 * a volt dot; the others stay faint. Used for the Community tabs and the search segments.
 */
export function SectionTabs<T extends string>({
  label,
  options,
  value,
  onChange,
  labelOf,
  className,
}: {
  label: string
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  labelOf: (v: T) => string
  className?: string
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('mb-5 flex items-center', className)}>
      {options.map((v, i) => {
        const active = v === value
        return (
          <div key={v} className="flex flex-1 items-center">
            {i > 0 && <span aria-hidden className="h-4 w-px bg-line-strong" />}
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(v)}
              className="relative flex h-12 flex-1 flex-col items-center justify-center"
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
