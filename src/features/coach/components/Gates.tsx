import { useTranslation } from 'react-i18next'
import { format, formatDistanceStrict } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { Clock, ShieldAlert } from 'lucide-react'
import { AiConsentCard } from '@/features/privacy/components/AiConsent'
import type { AiAvailability } from '@/features/nutrition'

/** What the coach sends, then the shared AI consent (18+, free-tier terms, region). */
export function CoachConsent() {
  const { t } = useTranslation('coach')
  return (
    <div className="space-y-3">
      <p className="px-1 text-[13px] leading-relaxed text-ink-muted">{t('consent.lead')}</p>
      <AiConsentCard />
    </div>
  )
}

/** The AI gate refused for age (a birth year under 18). */
export function UnderageNote() {
  const { t } = useTranslation('coach')
  return (
    <div role="status" className="hairline rounded-[var(--radius-card)] bg-surface p-4">
      <p className="flex items-center gap-2 text-[15px] font-semibold">
        <ShieldAlert className="size-4 shrink-0 text-ink-muted" aria-hidden />
        {t('underage.title')}
      </p>
      <p className="mt-1.5 text-[13px] leading-snug text-ink-muted">{t('underage.body')}</p>
    </div>
  )
}

/** Why the AI is closed right now and until when. */
export function CoachStatusCard({ status }: { status: AiAvailability }) {
  const { t, i18n } = useTranslation('coach')
  const locale = i18n.resolvedLanguage === 'en' ? enUS : tr
  const reason = status.reason === 'ok' ? 'google_minute' : status.reason
  const at = status.resets_at ? new Date(status.resets_at) : null
  const vars = at ? { time: format(at, 'HH:mm', { locale }), in: formatDistanceStrict(at, new Date(), { locale }) } : { time: '–', in: '–' }
  return (
    <div role="status" className="hairline rounded-[var(--radius-card)] bg-surface p-4">
      <p className="flex items-center gap-2 text-[15px] font-semibold">
        <Clock className="size-4 shrink-0 text-ink-muted" aria-hidden />
        {t(`status.${reason}.title`)}
      </p>
      <p className="mt-1.5 text-[13px] leading-snug text-ink-muted">{t(`status.${reason}.body`, vars)}</p>
    </div>
  )
}
