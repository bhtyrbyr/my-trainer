import { useTranslation } from 'react-i18next'
import { AlertCircle } from 'lucide-react'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

/** Inline, human-readable error for any thrown value (Supabase, network, runtime). Renders nothing when there is no error. */
export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  const { t } = useTranslation('common')
  if (!error) return null
  return (
    <p
      role="alert"
      className={cn(
        'hairline flex items-start gap-2 rounded-[var(--radius-input)] bg-danger/10 px-3.5 py-3 text-sm text-danger',
        className,
      )}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{errorMessage(error, t)}</span>
    </p>
  )
}
