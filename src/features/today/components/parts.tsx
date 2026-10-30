import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The tick. Done = filled volt disc; a counter in progress draws its share as a ring. 44pt target
 * around a 28pt mark.
 */
export function TickButton({ done, progress = 0, label, onClick, disabled }: { done: boolean; progress?: number; label: string; onClick: () => void; disabled?: boolean }) {
  const r = 12.5
  const c = 2 * Math.PI * r
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={done}
      disabled={disabled}
      onClick={onClick}
      className="group -m-2 flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
    >
      <span
        className={cn(
          'relative flex size-7 items-center justify-center rounded-full transition-colors duration-200',
          done ? 'bg-volt text-volt-ink' : 'border-[1.5px] border-ink-faint/60 group-hover:border-ink-muted',
        )}
      >
        {done && <Check className="size-4" strokeWidth={3} aria-hidden />}
        {!done && progress > 0 && (
          <svg viewBox="0 0 28 28" className="absolute inset-[-1.5px] size-7 -rotate-90" aria-hidden>
            <circle cx="14" cy="14" r={r} fill="none" stroke="var(--color-volt)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${c * Math.min(progress, 1)} ${c}`} />
          </svg>
        )}
      </span>
    </button>
  )
}

/** Small round +/- for counter habits. */
export function MiniStep({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-9 items-center justify-center rounded-full bg-raised text-ink-muted transition-colors hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  )
}

