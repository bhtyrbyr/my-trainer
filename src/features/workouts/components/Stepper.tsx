import { useId, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { clamp, parseDecimal, stepValue } from '../logic'

type Props = {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  step: number
  min?: number
  max?: number
  /** small unit set after the number (kg, sn, ...) */
  unit?: string
  format?: (n: number) => string
  /** allow decimals when typing (weights) */
  decimal?: boolean
  size?: 'lg' | 'sm'
  decLabel: string
  incLabel: string
  className?: string
}

/**
 * Number stepper. `lg` is the gym instrument: 64pt +/- pads either side of a display-size figure.
 * Tapping the figure turns it into a text field (decimal keypad on iOS) for jumps the buttons are too slow for.
 */
export function Stepper({
  label,
  value,
  onChange,
  step,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  unit,
  format = (n) => String(n),
  decimal = false,
  size = 'lg',
  decLabel,
  incLabel,
  className,
}: Props) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lg = size === 'lg'

  const commit = () => {
    if (draft === null) return
    const n = parseDecimal(draft)
    if (n !== null) onChange(clamp(decimal ? n : Math.round(n), min, max))
    else if (draft.trim() === '') onChange(null)
    setDraft(null)
  }

  const pad = cn(
    'flex shrink-0 items-center justify-center rounded-[var(--radius-button)] bg-raised text-ink hairline transition-[transform,background-color] duration-150 active:scale-95 active:bg-line-strong disabled:opacity-30',
    lg ? 'size-16' : 'size-11',
  )

  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className={cn('eyebrow block', lg ? 'mb-2' : 'mb-1.5')}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={pad}
          aria-label={decLabel}
          disabled={value !== null && value <= min}
          onClick={() => onChange(stepValue(value, -step, min, max))}
        >
          <Minus className={lg ? 'size-6' : 'size-4'} aria-hidden />
        </button>

        <div className="relative flex min-w-0 flex-1 items-baseline justify-center">
          {draft !== null ? (
            <input
              ref={inputRef}
              id={id}
              autoFocus
              type="text"
              inputMode={decimal ? 'decimal' : 'numeric'}
              enterKeyHint="done"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setDraft(null)
              }}
              className={cn(
                'display tabular w-full min-w-0 rounded-[var(--radius-input)] bg-surface text-center text-ink outline-none ring-2 ring-volt',
                lg ? 'h-16 text-[44px]' : 'h-11 text-[22px]',
              )}
            />
          ) : (
            <button
              id={id}
              type="button"
              onClick={() => setDraft(value === null ? '' : String(value))}
              className={cn(
                'flex min-w-0 items-baseline justify-center gap-1 rounded-[var(--radius-input)] px-1',
                lg ? 'h-16' : 'h-11',
              )}
            >
              <span className={cn('display tabular leading-none', lg ? 'text-[56px]' : 'text-[24px]', value === null && 'text-ink-faint')}>
                {value === null ? '–' : format(value)}
              </span>
              {unit && <span className={cn('font-medium text-ink-faint', lg ? 'text-base' : 'text-xs')}>{unit}</span>}
            </button>
          )}
        </div>

        <button
          type="button"
          className={pad}
          aria-label={incLabel}
          disabled={value !== null && value >= max}
          onClick={() => onChange(stepValue(value, step, min, max))}
        >
          <Plus className={lg ? 'size-6' : 'size-4'} aria-hidden />
        </button>
      </div>
    </div>
  )
}
