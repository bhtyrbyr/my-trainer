import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HeartPulse } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BottomSheet } from '@/features/nutrition/components/BottomSheet'
import { HealthConsentScreen } from './Gates'

/** Track page without health consent: one quiet card in place of body, nutrition, sleep/water and photos. */
export function HealthLockedCard() {
  const { t } = useTranslation('legal')
  const [open, setOpen] = useState(false)
  return (
    <section aria-label={t('health.locked')} className="hairline flex items-center gap-4 rounded-[var(--radius-card)] bg-surface px-4 py-4">
      <HeartPulse className="size-6 shrink-0 text-ink-faint" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">{t('health.locked')}</p>
        <p className="mt-0.5 text-[12px] leading-snug text-ink-faint">{t('health.lockedHint')}</p>
      </div>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t('health.enable')}
      </Button>
      <BottomSheet open={open} label={t('health.title')} closeLabel={t('notice.close')} onClose={() => setOpen(false)}>
        <div className="pb-5">
          <HealthConsentScreen onLater={() => setOpen(false)} />
        </div>
      </BottomSheet>
    </section>
  )
}
