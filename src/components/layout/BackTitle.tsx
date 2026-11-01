import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

/** Leading block of a pushed screen's header: a 44 px back link and the title. */
export function BackTitle({ to, label, title }: { to: string; label: string; title: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Link
        to={to}
        aria-label={label}
        className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </Link>
      <span className="truncate text-lg font-bold tracking-tight">{title}</span>
    </div>
  )
}
