import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { format, isToday } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { ArrowLeft, Plus, Sparkles, Trash2 } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { useAiAvailability } from '@/features/nutrition'
import { useConsents } from '@/features/privacy/hooks'
import { useConversations, useDeleteConversation } from '../hooks'
import type { QuickPrompt } from '../logic'
import { useCoachBase } from '../previewContext'
import { CoachConsent, CoachStatusCard } from '../components/Gates'
import { QuickPrompts } from '../components/QuickPrompts'

/** Profile > AI coach: quick questions on top, then the conversations (newest activity first). */
export function CoachPage() {
  const { t, i18n } = useTranslation(['coach', 'common'])
  const navigate = useNavigate()
  const base = useCoachBase()
  const consents = useConsents()
  const availability = useAiAvailability()
  const conversations = useConversations()
  const del = useDeleteConversation()
  const locale = i18n.resolvedLanguage === 'en' ? enUS : tr

  const consentOk = !consents.isLoading && consents.ai
  const blocked = availability.data && !availability.data.available ? availability.data : null
  const list = conversations.data ?? []
  // a quick question opens a fresh chat that sends it once (see ChatPage)
  const pick = (p: QuickPrompt) => navigate(`${base}/coach/new`, { state: { prompt: p } })
  const when = (iso: string) => {
    const d = new Date(iso)
    return isToday(d) ? format(d, 'HH:mm', { locale }) : format(d, 'd MMM', { locale })
  }

  return (
    <PageShell
      title={t('coach:title')}
      leading={
        <div className="flex items-center gap-1">
          <Link
            to={`${base}/settings`}
            aria-label={t('coach:back')}
            className="-ml-2 flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <span className="text-lg font-bold tracking-tight">{t('coach:title')}</span>
        </div>
      }
      actions={
        consentOk ? (
          <Button variant="ghost" size="icon" aria-label={t('coach:new')} title={t('coach:new')} onClick={() => navigate(`${base}/coach/new`)}>
            <Plus className="size-5" aria-hidden />
          </Button>
        ) : undefined
      }
    >
      <div className="mx-auto max-w-2xl space-y-8 pb-6 lg:grid lg:max-w-none lg:grid-cols-2 lg:items-start lg:gap-8 lg:space-y-0">
        <div className="space-y-5">
          <header className="rise-in pt-2">
            <p className="eyebrow flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-volt" aria-hidden />
              {t('coach:eyebrow')}
            </p>
            <h2 className="display mt-3 text-[34px] [text-wrap:balance]">{t('coach:list.heading')}</h2>
            <p className="mt-3 max-w-[38ch] text-[14px] leading-relaxed text-ink-muted">{t('coach:list.lead')}</p>
          </header>

          {consents.isLoading ? null : !consents.ai ? (
            <CoachConsent />
          ) : (
            <section aria-labelledby="coach-ask" className="space-y-2">
              <h3 id="coach-ask" className="eyebrow px-1">
                {t('coach:list.ask')}
              </h3>
              {blocked && <CoachStatusCard status={blocked} />}
              <QuickPrompts disabled={Boolean(blocked)} onPick={pick} />
              {!blocked && availability.data?.user_left != null && (
                <p className="tabular px-1 text-[12px] text-ink-faint">{t('coach:quota.left', { count: availability.data.user_left })}</p>
              )}
            </section>
          )}
        </div>

        <section aria-labelledby="coach-conversations" className="space-y-2 lg:pt-2">
          <h3 id="coach-conversations" className="eyebrow px-1">
            {t('coach:list.conversations')}
          </h3>
          <ErrorNote error={conversations.error ?? del.error} />
          {conversations.isLoading ? (
            <div className="hairline h-40 animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none" aria-busy="true" />
          ) : list.length === 0 ? (
            <p className="px-1 text-[14px] leading-relaxed text-ink-muted">{t('coach:list.empty')}</p>
          ) : (
            <ul className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
              {list.map((c) => {
                const title = c.title ?? t('coach:list.untitled')
                return (
                  <li key={c.id} className="flex items-center">
                    <Link
                      to={`${base}/coach/${c.id}`}
                      className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-1 transition-colors hover:bg-raised/50"
                    >
                      <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">{title}</span>
                      <span className="tabular shrink-0 text-[12px] text-ink-faint">{when(c.updated_at)}</span>
                    </Link>
                    <button
                      type="button"
                      aria-label={`${t('coach:list.delete')}: ${title}`}
                      disabled={del.isPending}
                      onClick={() => window.confirm(t('coach:list.deleteConfirm')) && del.mutate(c.id)}
                      className="flex size-11 shrink-0 items-center justify-center text-ink-faint transition-colors hover:text-danger disabled:opacity-40"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="px-1 pt-2 text-[12px] leading-snug text-ink-faint">{t('coach:disclaimer')}</p>
          <p className="px-1 text-[12px] leading-snug text-ink-faint">{t('coach:privacy')}</p>
        </section>
      </div>
    </PageShell>
  )
}
