import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'

type Props = {
  open: boolean
  title: string
  body?: ReactNode
  confirmLabel: string
  tone?: 'primary' | 'danger'
  pending?: boolean
  error?: unknown
  onConfirm: () => void
  onCancel: () => void
}

/** Bottom sheet for decisions (finish, delete, archive). Actions sit in the thumb zone. */
export function ConfirmSheet({ open, title, body, confirmLabel, tone = 'primary', pending, error, onConfirm, onCancel }: Props) {
  const { t } = useTranslation('workouts')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center lg:items-center" role="presentation">
      <button type="button" aria-label={t('common.cancel')} className="absolute inset-0 bg-bg/70 backdrop-blur-sm" onClick={onCancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="rise-in hairline relative w-full max-w-md rounded-t-[var(--radius-sheet)] bg-surface px-5 pb-safe pt-6 lg:rounded-[var(--radius-sheet)] lg:pb-0"
      >
        <h2 className="display text-[24px]">{title}</h2>
        {body && <div className="mt-2 text-[15px] leading-relaxed text-ink-muted">{body}</div>}
        <ErrorNote error={error} className="mt-4" />
        <div className="mt-6 grid gap-2 pb-5">
          <Button size="lg" variant={tone === 'danger' ? 'danger' : 'primary'} disabled={pending} onClick={onConfirm}>
            {pending && <Loader2 className="size-5 animate-spin" aria-hidden />}
            {confirmLabel}
          </Button>
          <Button size="lg" variant="ghost" onClick={onCancel} disabled={pending}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </div>
  )
}
