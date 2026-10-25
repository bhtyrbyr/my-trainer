import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Props = {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}

/** Standard page frame: sticky header under the iPhone status bar, padded scrolling content. */
export function PageShell({ title, subtitle, actions, children, className }: Props) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur pt-safe">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="truncate text-xs text-ink-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </header>
      <div className={cn('flex-1 px-4 py-4', className)}>{children}</div>
    </div>
  )
}
