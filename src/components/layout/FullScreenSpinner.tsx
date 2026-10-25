import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

export function FullScreenSpinner({ label }: { label?: string }) {
  const { t } = useTranslation('common')
  return (
    <div role="status" className="flex min-h-dvh flex-col items-center justify-center gap-3 text-slate-400">
      <Loader2 className="size-8 animate-spin text-brand-400" aria-hidden />
      <span className="text-sm">{label ?? t('loading')}</span>
    </div>
  )
}
