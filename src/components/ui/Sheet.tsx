import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Props = {
  open: boolean
  /** Accessible name of the dialog. */
  label: string
  /** Accessible name of the backdrop button. */
  closeLabel: string
  onClose: () => void
  children: ReactNode
  className?: string
}

/**
 * Bottom sheet on phones, centred dialog on desktop. Escape and the backdrop close it; content sits
 * above the home indicator (pb-safe). Same frame as the nutrition and workout sheets.
 */
export function Sheet({ open, label, closeLabel, onClose, children, className }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center lg:items-center" role="presentation">
      <button
        type="button"
        aria-label={closeLabel}
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          'rise-in hairline relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[var(--radius-sheet)] bg-surface px-5 pb-safe pt-6 lg:rounded-[var(--radius-sheet)] lg:pb-0',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}
