import { useTranslation } from 'react-i18next'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { QUICK_PROMPTS, type QuickPrompt } from '../logic'

/** One-tap questions as a ruled list; each tap sends exactly one question. */
export function QuickPrompts({ onPick, disabled, className }: { onPick: (p: QuickPrompt) => void; disabled?: boolean; className?: string }) {
  const { t } = useTranslation('coach')
  return (
    <ul className={cn('hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface', className)}>
      {QUICK_PROMPTS.map((p, i) => (
        <li key={p} className="rise-in" style={{ '--i': i + 1 } as React.CSSProperties}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(p)}
            className="group flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left text-[15px] font-medium text-ink transition-colors hover:bg-raised/50 disabled:opacity-40"
          >
            <span className="flex-1">{t(`prompts.${p}`)}</span>
            <ArrowUpRight className="size-4 shrink-0 text-ink-faint transition-colors group-hover:text-volt" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}
