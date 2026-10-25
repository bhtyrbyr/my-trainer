import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { tr as trLocale, enUS } from 'date-fns/locale'
import { ArrowLeft, Check, Inbox, X } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { avatarUrl } from '@/features/profile/api'
import { cn } from '@/lib/utils'
import type { RegistrationStatus } from '@/lib/database.types'
import { useAuth } from '@/features/auth/AuthProvider'
import { useRegistrations, useSetRegistrationStatus } from '../hooks'

const TABS: RegistrationStatus[] = ['pending', 'approved', 'rejected']

/** Admin inbox for registrations. Segmented filter, one row per request, approve/reject inline. */
export function RegistrationRequestsPage() {
  const { t, i18n } = useTranslation(['admin', 'common'])
  const [tab, setTab] = useState<RegistrationStatus>('pending')
  const { data, isLoading, error } = useRegistrations(tab)
  const mutation = useSetRegistrationStatus()
  const { user } = useAuth()
  const dfLocale = i18n.resolvedLanguage === 'en' ? enUS : trLocale

  return (
    <PageShell
      title={t('admin:requests.title')}
      actions={
        <Link to="/settings" className="touch-target flex items-center justify-center rounded-full text-ink-muted hover:text-ink" aria-label={t('common:nav.settings')}>
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
      }
    >
      <div role="tablist" aria-label={t('admin:requests.title')} className="hairline mb-4 grid grid-cols-3 rounded-full bg-surface p-1">
        {TABS.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={tab === s}
            onClick={() => setTab(s)}
            className={cn(
              'h-9 rounded-full text-sm font-medium transition-colors',
              tab === s ? 'bg-raised text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {t(`admin:status.${s}`)}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="hairline rounded-[var(--radius-input)] bg-danger/10 px-4 py-3 text-sm text-danger">
          {t('common:error')} {error.message}
        </p>
      )}

      {isLoading ? (
        <p className="py-10 text-center text-sm text-ink-faint">{t('common:loading')}</p>
      ) : !data?.length ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-ink-faint">
          <Inbox className="size-8" aria-hidden />
          <p className="text-sm">{t(`admin:requests.empty.${tab}`)}</p>
        </div>
      ) : (
        <ul className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
          {data.map((r) => {
            const busy = mutation.isPending && mutation.variables?.userId === r.user_id
            const isSelf = r.user_id === user?.id
            const src = avatarUrl(r.avatar_path, r.created_at)
            return (
              <li key={r.user_id} className="flex items-center gap-3 p-3">
                {src ? <img src={src} alt="" className="size-11 rounded-full object-cover" /> : <span className="size-11 rounded-full bg-raised" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold leading-tight">{r.display_name}</p>
                  <p className="truncate text-xs text-ink-muted">
                    @{r.username} · {r.email}
                  </p>
                  <p className="text-[11px] text-ink-faint">
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true, locale: dfLocale })}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {isSelf && <span className="self-center text-xs text-ink-faint">{t('admin:you')}</span>}
                  {!isSelf && r.status !== 'approved' && (
                    <Button
                      size="icon"
                      aria-label={t('admin:actions.approve')}
                      title={t('admin:actions.approve')}
                      disabled={busy}
                      onClick={() => mutation.mutate({ userId: r.user_id, status: 'approved' })}
                    >
                      <Check className="size-5" aria-hidden />
                    </Button>
                  )}
                  {!isSelf && r.status !== 'rejected' && (
                    <Button
                      size="icon"
                      variant="secondary"
                      aria-label={t('admin:actions.reject')}
                      title={t('admin:actions.reject')}
                      disabled={busy}
                      onClick={() => mutation.mutate({ userId: r.user_id, status: 'rejected' })}
                    >
                      <X className="size-5" aria-hidden />
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </PageShell>
  )
}
