import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { useGrantAiConsent } from '../hooks'

/**
 * Explicit consent before the first AI request (Gemini / OpenRouter free tiers): what is sent, who may
 * read it, 18+ and the region limit. Shown in place of the estimate form until given.
 */
export function AiConsentCard({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation('legal')
  const grant = useGrantAiConsent()
  const [adult, setAdult] = useState(false)
  const [region, setRegion] = useState(false)
  const box = 'size-5 shrink-0 accent-[var(--color-volt)]'
  return (
    <section className="hairline space-y-4 rounded-[var(--radius-card)] bg-surface p-4">
      <div>
        <p className="eyebrow flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-volt" aria-hidden />
          {t('ai.eyebrow')}
        </p>
        <h3 className="mt-2 text-[18px] font-semibold tracking-tight">{t('ai.title')}</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{t('ai.body')}</p>
      </div>
      <p className="rounded-[var(--radius-input)] bg-bg px-3 py-2.5 text-[13px] leading-relaxed text-ink">{t('ai.statement')}</p>
      <div className="space-y-1">
        <label className="flex min-h-11 items-center gap-3 text-[14px]">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className={box} />
          {t('ai.adult')}
        </label>
        <label className="flex min-h-11 items-center gap-3 text-[14px]">
          <input type="checkbox" checked={region} onChange={(e) => setRegion(e.target.checked)} className={box} />
          {t('ai.region')}
        </label>
      </div>
      <p className="text-[12px] leading-snug text-ink-faint">{t('ai.hint')}</p>
      <ErrorNote error={grant.error} />
      <Button className="w-full" disabled={!adult || !region || grant.isPending} onClick={() => grant.mutate(undefined, { onSuccess: onDone })}>
        {grant.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {t('ai.agree')}
      </Button>
    </section>
  )
}
