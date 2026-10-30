import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, Loader2 } from 'lucide-react'
import { MAX_INPUT, sendable } from '../logic'

/**
 * Message box pinned above the tab bar (desktop: the bottom of the column). Grows to five lines;
 * Enter sends, Shift+Enter breaks the line. The line under it carries the day's AI allowance.
 */
export function Composer({
  disabled,
  busy,
  footnote,
  onSend,
}: {
  disabled: boolean
  busy: boolean
  footnote?: string | null
  onSend: (text: string) => void
}) {
  const { t } = useTranslation('coach')
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const value = sendable(text)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [text])

  const submit = () => {
    if (!value || disabled || busy) return
    onSend(value)
    setText('')
  }

  return (
    <div className="sticky bottom-[calc(var(--nav-h)+var(--sab))] z-20 -mx-4 mt-auto border-t border-line bg-bg/90 px-4 pb-5 pt-3 backdrop-blur lg:bottom-0 lg:pb-4">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label htmlFor="coach-input" className="sr-only">
          {t('chat.label')}
        </label>
        <textarea
          id="coach-input"
          ref={ref}
          rows={1}
          value={text}
          maxLength={MAX_INPUT}
          enterKeyHint="send"
          disabled={disabled}
          placeholder={t('chat.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          className="hairline min-h-11 flex-1 resize-none rounded-[22px] bg-surface px-4 py-[10px] text-[16px] leading-[22px] text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-volt disabled:opacity-50"
        />
        <button
          type="submit"
          aria-label={t('chat.send')}
          disabled={!value || disabled || busy}
          className="inner-glow flex size-11 shrink-0 items-center justify-center rounded-full bg-volt text-volt-ink transition-[transform,background-color] duration-150 ease-out hover:bg-volt-hover active:scale-95 disabled:bg-raised disabled:text-ink-faint disabled:shadow-none"
        >
          {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ArrowUp className="size-5" strokeWidth={2.25} aria-hidden />}
        </button>
      </form>
      <div className="tabular mt-1.5 flex min-h-4 items-center justify-between gap-3 px-1 text-[11px] text-ink-faint">
        <span>{footnote}</span>
        {text.length > MAX_INPUT * 0.8 && <span>{t('chat.counter', { n: text.length, max: MAX_INPUT })}</span>}
      </div>
    </div>
  )
}
