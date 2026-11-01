import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { Sheet } from '@/components/ui/Sheet'
import { cn } from '@/lib/utils'
import * as api from '../api'
import { formatReport, REPORT_REASONS, type ReportReason } from '../logic'
import { useSocialAction } from '../hooks'

/** Report a post, user or group: one reason, an optional note, then a calm confirmation. */
export function ReportSheet({
  open,
  onClose,
  kind,
  targetId,
}: {
  open: boolean
  onClose: () => void
  kind: 'post' | 'user' | 'group'
  targetId: string
}) {
  const { t } = useTranslation(['social', 'common'])
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [note, setNote] = useState('')
  const send = useSocialAction(() => api.report(kind, targetId, formatReport(reason ?? 'other', note)))

  const close = () => {
    onClose()
    setReason(null)
    setNote('')
    send.reset()
  }

  return (
    <Sheet
      open={open}
      label={t(`social:report.title.${kind}`)}
      closeLabel={t('common:cancel')}
      onClose={close}
    >
      <div className="pb-5">
        {send.isSuccess ? (
          <>
            <h2 className="display text-[24px]">{t('social:report.sentTitle')}</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{t('social:report.sentBody')}</p>
            <Button size="lg" variant="secondary" className="mt-6 w-full" onClick={close}>
              {t('social:done')}
            </Button>
          </>
        ) : (
          <>
            <h2 className="display text-[24px]">{t(`social:report.title.${kind}`)}</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{t('social:report.intro')}</p>
            <div
              role="radiogroup"
              aria-label={t('social:report.reason')}
              className="hairline mt-5 divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-bg/40"
            >
              {REPORT_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={reason === r}
                  onClick={() => setReason(r)}
                  className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] hover:bg-raised/60"
                >
                  <span className="flex-1">{t(`social:report.reasons.${r}`)}</span>
                  <Check className={cn('size-5 text-volt', reason !== r && 'invisible')} aria-hidden />
                </button>
              ))}
            </div>
            <label className="mt-4 block">
              <span className="section-title">{t('social:report.note')}</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={240}
                rows={2}
                className="hairline mt-1.5 w-full resize-none rounded-[var(--radius-input)] bg-bg px-3 py-2.5 text-[16px] outline-none focus:border-volt"
              />
            </label>
            <ErrorNote error={send.error} className="mt-3" />
            <div className="mt-5 grid gap-2">
              <Button size="lg" disabled={!reason || send.isPending} onClick={() => send.mutate(undefined)}>
                {send.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
                {t('social:report.send')}
              </Button>
              <Button size="lg" variant="ghost" onClick={close}>
                {t('common:cancel')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}
