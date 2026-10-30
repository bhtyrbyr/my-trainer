import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronRight, Sparkles } from 'lucide-react'

/**
 * Home: one quiet row that opens a fresh coach chat with the weekly-review question. Nothing is sent
 * until the user taps it (every answer spends shared AI quota).
 */
export function WeeklyReviewCard({ base = '' }: { base?: string }) {
  const { t } = useTranslation('coach')
  return (
    <Link
      to={`${base}/coach/new`}
      state={{ prompt: 'weekly' }}
      className="hairline group flex min-h-16 items-center gap-3 rounded-[var(--radius-card)] bg-surface px-4 py-3.5 transition-colors hover:bg-raised/50"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-volt">
        <Sparkles className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-tight text-ink">{t('home.title')}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-ink-muted">{t('home.body')}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-ink-faint transition-colors group-hover:text-ink-muted" aria-hidden />
    </Link>
  )
}
