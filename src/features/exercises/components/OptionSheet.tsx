import { useEffect, useRef } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Option = { value: string; label: string }

type Props = {
  open: boolean
  title: string
  closeLabel: string
  /** label of the "no filter" row */
  anyLabel: string
  options: Option[]
  value: string | undefined
  onChange: (value: string | undefined) => void
  onClose: () => void
}

/** Bottom sheet with a single-choice list; used for the muscle and equipment filters. */
export function OptionSheet({ open, title, closeLabel, anyLabel, options, value, onChange, onClose }: Props) {
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    // bring the current choice into view and give it focus
    window.setTimeout(() => listRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus(), 30)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const pick = (v: string | undefined) => {
    onChange(v)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label={closeLabel} tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-bg/70 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="hairline rise-in relative mx-auto flex max-h-[78dvh] w-full max-w-md flex-col rounded-t-[var(--radius-sheet)] border-b-0 bg-surface pb-safe"
      >
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
          <h2 className="display text-[22px]">{title}</h2>
          <Button variant="ghost" size="icon" aria-label={closeLabel} onClick={onClose} className="-mr-2">
            <X className="size-5" aria-hidden />
          </Button>
        </div>
        <ul ref={listRef} role="radiogroup" aria-label={title} className="flex-1 divide-y divide-line overflow-y-auto px-5 pb-4">
          {[{ value: undefined, label: anyLabel } as { value: string | undefined; label: string }, ...options].map((o) => {
            const selected = o.value === value
            return (
              <li key={o.value ?? '__any'}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => pick(o.value)}
                  className={cn(
                    'flex min-h-12 w-full items-center justify-between gap-3 text-left text-[15px] transition-colors',
                    selected ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink',
                    o.value === undefined && !selected && 'text-ink-faint',
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {selected && <Check className="size-4 shrink-0 text-volt" aria-hidden />}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
