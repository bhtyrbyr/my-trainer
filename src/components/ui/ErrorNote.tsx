import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Check, Loader2, Send } from 'lucide-react'
import { errorMessage } from '@/lib/errors'
import { isReportable, sendErrorReport } from '@/lib/errorReport'
import { cn } from '@/lib/utils'

/**
 * Inline, human-readable error for any thrown value (Supabase, network, runtime). Errors the user
 * cannot fix themselves get a "report to admin" button that sends the failing request and the
 * server's answer (sanitized) to the admin's error reports. Renders nothing when there is no error.
 */
export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  const { t } = useTranslation('common')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const [reported, setReported] = useState<unknown>(null)
  if (!error) return null
  const current = reported === error ? state : 'idle'

  const report = async () => {
    setReported(error)
    setState('sending')
    try {
      await sendErrorReport(error)
      setState('sent')
    } catch (e) {
      console.error('error report failed', e)
      setState('failed')
    }
  }

  return (
    <div role="alert" className={cn('hairline rounded-[var(--radius-input)] bg-danger/10 px-3.5 py-3 text-sm text-danger', className)}>
      <p className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{errorMessage(error, t)}</span>
      </p>
      {isReportable(error) && (
        <div className="mt-2 flex items-center justify-between gap-3 pl-6">
          <span className="text-[12px] text-ink-muted">
            {current === 'sent' ? t('errors.reportSent') : current === 'failed' ? t('errors.reportFailed') : t('errors.reportHint')}
          </span>
          {current !== 'sent' && (
            <button
              type="button"
              onClick={() => void report()}
              disabled={current === 'sending'}
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-ink hover:bg-raised disabled:opacity-60"
            >
              {current === 'sending' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
              {t('errors.report')}
            </button>
          )}
          {current === 'sent' && <Check className="size-4 shrink-0 text-volt" aria-hidden />}
        </div>
      )}
    </div>
  )
}
