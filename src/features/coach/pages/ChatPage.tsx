import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { useAiAvailability } from '@/features/nutrition'
import { useConsents } from '@/features/privacy/hooks'
import { useAsk, useConversations, useDeleteConversation, useMessages, useReply, useReplyState } from '../hooks'
import { isQuickPrompt, type QuickPrompt } from '../logic'
import { useCoachBase } from '../previewContext'
import { Composer } from '../components/Composer'
import { CoachConsent, CoachStatusCard, UnderageNote } from '../components/Gates'
import { MessageBubble, TypingBubble } from '../components/Messages'
import { QuickPrompts } from '../components/QuickPrompts'

/**
 * One conversation (/coach/:id; `new` before the first question). The user's message is stored first,
 * then the ai-coach function is asked for the reply; the typing state lives in the mutation cache, so
 * it survives leaving the chat and coming back.
 */
export function ChatPage() {
  const { t } = useTranslation(['coach', 'common'])
  const params = useParams()
  const id = params.id && params.id !== 'new' ? params.id : null
  const base = useCoachBase()
  const navigate = useNavigate()
  const location = useLocation()

  const consents = useConsents()
  const availability = useAiAvailability()
  const conversations = useConversations()
  const messages = useMessages(id)
  const ask = useAsk()
  const reply = useReply()
  const replyState = useReplyState(id)
  const del = useDeleteConversation()

  const consentOk = !consents.isLoading && consents.ai
  const blocked = availability.data && !availability.data.available ? availability.data : null
  const underage = replyState.error?.message === 'AI_UNDERAGE'
  const thinking = ask.isPending || replyState.pending
  const canAsk = consentOk && !blocked && !underage && !thinking

  const list = messages.data ?? []
  const conversation = id ? conversations.data?.find((c) => c.id === id) : undefined
  const missing = id !== null && conversations.isSuccess && !conversation && !ask.isPending
  const last = list[list.length - 1]
  const unanswered = !thinking && last?.role === 'user'

  const send = useCallback(
    (text: string) => {
      ask.mutate(
        { conversationId: id, text },
        {
          onSuccess: ({ conversationId }) => {
            if (!id) navigate(`${base}/coach/${conversationId}`, { replace: true })
            reply.mutate({ conversationId })
          },
        },
      )
    },
    [ask, reply, id, base, navigate],
  )
  const pick = (p: QuickPrompt) => send(t(`coach:prompts.${p}`))

  // Opened from Home's weekly review (or a quick question on the list): send that one question once.
  // The tap was the request; the history entry is cleared so a reload does not ask again.
  const startPrompt = (location.state as { prompt?: unknown } | null)?.prompt
  const started = useRef(false)
  useEffect(() => {
    if (started.current || id !== null || !isQuickPrompt(startPrompt)) return
    if (!consentOk || availability.isLoading || blocked) return
    started.current = true
    navigate(location.pathname, { replace: true, state: null })
    send(t(`coach:prompts.${startPrompt}`))
  }, [startPrompt, id, consentOk, availability.isLoading, blocked, navigate, location.pathname, send, t])

  // keep the newest message in view (only scrolls when it is hidden behind the composer)
  const count = list.length + (thinking ? 1 : 0)
  const first = useRef(true)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (count === 0) return
    const smooth = !first.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    first.current = false
    end.current?.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'instant' })
  }, [count])

  const title = conversation?.title ?? (id ? t('coach:list.untitled') : t('coach:new'))
  const remaining = !blocked && availability.data?.user_left != null ? t('coach:quota.left', { count: availability.data.user_left }) : null

  return (
    <PageShell
      title={title}
      className="flex flex-col pb-0"
      leading={
        <div className="flex min-w-0 items-center gap-1">
          <Link
            to={`${base}/coach`}
            aria-label={t('coach:back')}
            className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <span className="truncate text-lg font-bold tracking-tight">{title}</span>
        </div>
      }
      actions={
        id && conversation ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('coach:list.delete')}
            title={t('coach:list.delete')}
            disabled={del.isPending}
            onClick={() => window.confirm(t('coach:list.deleteConfirm')) && del.mutate(id, { onSuccess: () => navigate(`${base}/coach`, { replace: true }) })}
          >
            <Trash2 className="size-5" aria-hidden />
          </Button>
        ) : undefined
      }
    >
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
        <ErrorNote error={messages.error ?? conversations.error ?? del.error} className="mb-3" />

        {missing ? (
          <div className="hairline mt-2 rounded-[var(--radius-card)] bg-surface px-5 py-6">
            <p className="text-[15px] leading-relaxed text-ink-muted">{t('coach:chat.notFound')}</p>
            <Link to={`${base}/coach`} className="mt-3 inline-flex h-11 items-center text-[14px] font-semibold text-ink hover:text-volt">
              {t('coach:chat.toList')}
            </Link>
          </div>
        ) : (
          <>
            {list.length === 0 && !thinking && !messages.isLoading ? (
              <header className="rise-in pb-6 pt-4">
                <p className="eyebrow flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-volt" aria-hidden />
                  {t('coach:eyebrow')}
                </p>
                <h2 className="display mt-3 text-[34px]">{t('coach:chat.heading')}</h2>
                <p className="mt-3 max-w-[36ch] text-[14px] leading-relaxed text-ink-muted">{t('coach:chat.lead')}</p>
                {consentOk && <QuickPrompts className="mt-6" disabled={!canAsk} onPick={pick} />}
              </header>
            ) : (
              <p className="pb-4 pt-1 text-[12px] leading-snug text-ink-faint">{t('coach:disclaimer')}</p>
            )}

            <ol className="space-y-4 pb-4">
              {list.map((m, i) => (
                <MessageBubble key={m.id} message={m} index={list.length - i} />
              ))}
              {ask.isPending && ask.variables && <MessageBubble message={{ role: 'user', content: ask.variables.text }} pending />}
              {thinking && <TypingBubble />}
            </ol>
            {/* scroll target: the margin keeps it clear of the composer and the tab bar */}
            <div ref={end} aria-hidden className="scroll-mb-[calc(var(--nav-h)+var(--sab)+7rem)] lg:scroll-mb-28" />

            <div className="space-y-3 pb-4 empty:hidden">
              {underage ? (
                <UnderageNote />
              ) : (
                <>
                  <ErrorNote error={ask.error ?? replyState.error} />
                  {unanswered && consentOk && (
                    <div className="flex items-center justify-between gap-3 px-1">
                      <p className="text-[13px] text-ink-faint">{t('coach:chat.unanswered')}</p>
                      <Button variant="secondary" size="sm" className="h-11" disabled={!canAsk} onClick={() => id && reply.mutate({ conversationId: id })}>
                        <RotateCcw className="size-4" aria-hidden />
                        {t('coach:chat.retry')}
                      </Button>
                    </div>
                  )}
                </>
              )}
              {blocked && consentOk && !underage && <CoachStatusCard status={blocked} />}
              {!consents.isLoading && !consents.ai && <CoachConsent />}
            </div>

            {list.length === 0 && !thinking && consentOk && (
              <p className="pb-4 text-[12px] leading-snug text-ink-faint">
                {t('coach:disclaimer')} {t('coach:privacy')}
              </p>
            )}

            {consentOk && !underage && <Composer disabled={!consentOk || Boolean(blocked)} busy={thinking} footnote={remaining} onSend={send} />}
          </>
        )}
      </div>
    </PageShell>
  )
}
