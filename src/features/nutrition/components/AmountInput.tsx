import { useId, useState } from 'react'
import { cn } from '@/lib/utils'
import { parseAmount } from '../logic'

type Props = {
  label: string
  value: number
  onChange: (n: number) => void
  max: number
  integer?: boolean
  suffix?: string
  className?: string
}

/** Compact numeric field: decimal keypad on iOS, 16px text (no zoom), accepts "12,5". */
export function AmountInput({ label, value, onChange, max, integer, suffix, className }: Props) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value === 0 ? '' : String(value).replace('.', ','))
  const commit = (s: string) => {
    const n = parseAmount(s)
    if (n !== null) onChange(Math.min(max, integer ? Math.round(n) : Math.round(n * 10) / 10))
    setDraft(null)
  }
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className="mb-1 block truncate text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
        {label}
      </label>
      <div className="hairline flex h-11 items-center rounded-[var(--radius-input)] bg-bg px-2.5 focus-within:ring-2 focus-within:ring-volt">
        <input
          id={id}
          type="text"
          inputMode={integer ? 'numeric' : 'decimal'}
          enterKeyHint="done"
          placeholder="0"
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="tabular w-full min-w-0 bg-transparent text-[16px] font-semibold text-ink outline-none placeholder:text-ink-faint"
        />
        {suffix && <span className="ml-1 shrink-0 text-[12px] text-ink-faint">{suffix}</span>}
      </div>
    </div>
  )
}
