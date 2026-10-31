import { Fragment, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { formatReply, type Span } from '../logic'
import type { CoachMessage } from '../schema'

/** "Coach" lead above each reply: the only place the accent appears in the thread. */
function CoachMark() {
  const { t } = useTranslation('coach')
  return (
    <p className="eyebrow mb-1.5 flex items-center gap-1.5 pl-1">
      <span aria-hidden className="size-1.5 rounded-full bg-volt" />
      {t('chat.coach')}
    </p>
  )
}

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) =>
        s.bold ? (
          <strong key={i} className="font-semibold text-ink">
            {s.text}
          </strong>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  )
}

/** Reply text as paragraphs and lists (React text nodes only; model output is never HTML). */
function CoachText({ content }: { content: string }) {
  const blocks = useMemo(() => formatReply(content), [content])
  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) =>
        b.kind === 'p' ? (
          <p key={i}>
            <Spans spans={b.spans} />
          </p>
        ) : (
          <ul key={i} className="space-y-1.5">
            {b.items.map((item, j) => (
              <li key={j} className="flex gap-2.5">
                <span aria-hidden className="tabular w-4 shrink-0 text-right text-ink-faint">
                  {b.kind === 'ol' ? `${j + 1}.` : '–'}
                </span>
                <span className="min-w-0">
                  <Spans spans={item} />
                </span>
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  )
}

export function MessageBubble({
  message,
  pending,
  index = 0,
  children,
}: {
  message: Pick<CoachMessage, 'role' | 'content'>
  pending?: boolean
  index?: number
  /** Replaces the reply text (a program card shows the same content, structured). */
  children?: React.ReactNode
}) {
  if (message.role === 'user') {
    return (
      <li className="rise-in flex justify-end" style={{ '--i': Math.min(index, 4) } as React.CSSProperties}>
        <p
          className={cn(
            'max-w-[85%] whitespace-pre-wrap break-words rounded-[20px] rounded-br-[6px] bg-raised px-4 py-2.5 text-[15px] leading-[1.5] text-ink',
            pending && 'opacity-60',
          )}
        >
          {message.content}
        </p>
      </li>
    )
  }
  return (
    <li className="rise-in" style={{ '--i': Math.min(index, 4) } as React.CSSProperties}>
      <CoachMark />
      {children ?? (
        <div className="hairline max-w-[94%] break-words rounded-[20px] rounded-tl-[6px] bg-surface px-4 py-3 text-[15px] leading-[1.55] text-ink-muted">
          <CoachText content={message.content} />
        </div>
      )}
    </li>
  )
}

/** Three quiet dots while the coach answers (static with reduced motion). */
export function TypingBubble() {
  const { t } = useTranslation('coach')
  return (
    <li className="rise-in" aria-live="polite">
      <CoachMark />
      <div className="hairline inline-flex h-11 items-center gap-1.5 rounded-[20px] rounded-tl-[6px] bg-surface px-4">
        <span className="sr-only">{t('chat.typing')}</span>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden
            className="size-1.5 animate-pulse rounded-full bg-ink-muted motion-reduce:animate-none"
            style={{ animationDelay: `${i * 180}ms` }}
          />
        ))}
      </div>
    </li>
  )
}
