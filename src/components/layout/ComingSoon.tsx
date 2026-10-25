import { useTranslation } from 'react-i18next'
import { Construction } from 'lucide-react'

export function ComingSoon({ phase }: { phase: number }) {
  const { t } = useTranslation('common')
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line p-10 text-center text-ink-muted">
      <Construction className="size-8" aria-hidden />
      <p>{t('comingSoon')}</p>
      <span className="rounded-full bg-raised px-3 py-1 text-xs font-medium">{t('phase', { n: phase })}</span>
    </div>
  )
}
