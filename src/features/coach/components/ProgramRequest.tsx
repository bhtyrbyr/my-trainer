import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dumbbell, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PROGRAM_REQUEST_MAX } from '../logic'

/**
 * "Suggest a program": one pill that opens a short optional wish ("3 days, dumbbells"). Submitting
 * asks once; an empty wish is fine (the coach picks a balanced 3-day plan).
 */
export function ProgramRequest({ disabled, onSubmit, className }: { disabled: boolean; onSubmit: (request: string) => void; className?: string }) {
  const { t } = useTranslation('coach')
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const form = useRef<HTMLFormElement>(null)
  // the form opens right above the pinned composer; bring it fully into view
  useEffect(() => {
    if (open) form.current?.scrollIntoView({ block: 'nearest' })
  }, [open])

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          'hairline inline-flex h-11 items-center gap-2 rounded-full bg-surface pl-3.5 pr-4 text-[14px] font-semibold text-ink transition-colors hover:bg-raised disabled:opacity-40',
          className,
        )}
      >
        <Dumbbell className="size-4 text-volt" aria-hidden />
        {t('program.suggest')}
      </button>
    )
  }

  const submit = () => {
    if (disabled) return
    onSubmit(text.replace(/\s+/g, ' ').trim().slice(0, PROGRAM_REQUEST_MAX))
    setText('')
    setOpen(false)
  }

  return (
    <form
      ref={form}
      className={cn(
        'hairline rise-in scroll-mb-[calc(var(--nav-h)+var(--sab)+7rem)] rounded-[var(--radius-card)] bg-surface p-3 lg:scroll-mb-28',
        className,
      )}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="flex items-center justify-between gap-2 pl-1">
        <label htmlFor="coach-program-input" className="eyebrow flex items-center gap-1.5">
          <Dumbbell className="size-3.5 text-volt" aria-hidden />
          {t('program.suggest')}
        </label>
        <button
          type="button"
          aria-label={t('program.cancel')}
          onClick={() => setOpen(false)}
          className="-mr-1 flex size-11 items-center justify-center rounded-full text-ink-faint hover:bg-raised hover:text-ink"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="coach-program-input"
          autoFocus
          onFocus={() => form.current?.scrollIntoView({ block: 'nearest' })}
          value={text}
          maxLength={PROGRAM_REQUEST_MAX}
          enterKeyHint="send"
          placeholder={t('program.placeholder')}
          onChange={(e) => setText(e.target.value)}
          className="hairline h-11 min-w-0 flex-1 rounded-[var(--radius-input)] bg-bg px-3 text-[16px] text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-volt"
        />
        <Button type="submit" disabled={disabled} className="shrink-0">
          {t('program.submit')}
        </Button>
      </div>
      <p className="mt-2 px-1 text-[12px] leading-snug text-ink-faint">{t('program.hint')}</p>
    </form>
  )
}
