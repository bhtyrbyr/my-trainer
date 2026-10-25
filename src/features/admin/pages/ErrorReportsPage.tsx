import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { ArrowLeft, Check, ChevronDown, Copy, RotateCcw } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { cn } from '@/lib/utils'
import { useErrorReports, useSetErrorReportStatus } from '../hooks'

type Status = 'open' | 'resolved' | 'all'
type Report = Awaited<ReturnType<typeof import('../api').listErrorReports>>[number]

/** Admin inbox of user-sent error reports: who, where, which request, what the server said. */
export function ErrorReportsPage() {
  const { t } = useTranslation('admin')
  const [status, setStatus] = useState<Status>('open')
  const reports = useErrorReports(status)

  return (
    <PageShell
      title={t('reports.title')}
      leading={
        <div className="flex items-center gap-1">
          <Link to="/settings" aria-label={t('reports.back')} className="-ml-2 flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink">
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <span className="text-lg font-bold tracking-tight">{t('reports.title')}</span>
        </div>
      }
    >
      <div className="mx-auto max-w-3xl space-y-4 pb-6">
        <div role="tablist" className="hairline grid grid-cols-3 rounded-full bg-surface p-1">
          {(['open', 'resolved', 'all'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              onClick={() => setStatus(s)}
              className={cn('h-10 rounded-full text-[13px] font-medium transition-colors', status === s ? 'bg-raised text-ink' : 'text-ink-muted hover:text-ink')}
            >
              {t(`reports.tabs.${s}`)}
            </button>
          ))}
        </div>
        <ErrorNote error={reports.error} />
        {reports.isLoading ? (
          <div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-surface" aria-busy="true" />
        ) : (reports.data ?? []).length === 0 ? (
          <p className="hairline rounded-[var(--radius-card)] bg-surface px-4 py-6 text-[14px] text-ink-muted">{t('reports.empty')}</p>
        ) : (
          <ul className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
            {(reports.data ?? []).map((r) => (
              <ReportRow key={r.id} r={r} />
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  )
}

function ReportRow({ r }: { r: Report }) {
  const { t, i18n } = useTranslation(['admin', 'common'])
  const locale = i18n.resolvedLanguage === 'en' ? enUS : tr
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const setStatus = useSetErrorReportStatus()
  const who = r.display_name ?? r.username ?? t('admin:reports.unknownUser')
  const req = (r.request ?? {}) as Record<string, unknown>
  const res = (r.response ?? null) as Record<string, unknown> | null
  const fullText = JSON.stringify(r, null, 2)

  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-raised/50">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">{r.message_key ? t(`common:${r.message_key}`) : r.error_code}</span>
          <span className="block truncate text-[12px] text-ink-faint">
            {t('admin:reports.by', { name: who, time: format(new Date(r.created_at), 'd MMM HH:mm', { locale }) })} · <span className="font-mono">{String(req.method ?? '')} {String(req.path ?? r.route ?? '')}</span>
          </span>
        </span>
        {r.status === 'resolved' && <Check className="mt-1 size-4 shrink-0 text-volt" aria-hidden />}
        <ChevronDown className={cn('mt-1 size-4 shrink-0 text-ink-faint transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="space-y-3 border-t border-line bg-bg/40 px-4 py-3 text-[12px]">
          <Field label={t('admin:reports.screen')} value={r.route} />
          <Field label={t('admin:reports.version')} value={r.app_version} />
          <Field label={t('admin:reports.error')} value={[r.error_code, r.error_message].filter(Boolean).join('\n')} mono />
          {req.path ? (
            <Field label={t('admin:reports.request')} value={[`${String(req.method)} ${String(req.path)}`, req.body ? String(req.body) : null].filter(Boolean).join('\n')} mono />
          ) : (
            <Field label={t('admin:reports.noRequest')} value={Array.isArray(req.recent) ? (req.recent as string[]).join('\n') : null} mono />
          )}
          {res && <Field label={t('admin:reports.response')} value={[res.status != null ? `HTTP ${String(res.status)}` : null, res.network_error ? String(res.network_error) : null, res.body ? String(res.body) : null].filter(Boolean).join('\n')} mono />}
          {r.note && <Field label={t('admin:reports.note')} value={r.note} />}
          <Field label={t('admin:reports.device')} value={r.user_agent} />
          <ErrorNote error={setStatus.error} />
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              className="h-11"
              variant={r.status === 'open' ? 'primary' : 'secondary'}
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ id: r.id, status: r.status === 'open' ? 'resolved' : 'open' })}
            >
              {r.status === 'open' ? <Check className="size-4" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}
              {r.status === 'open' ? t('admin:reports.resolve') : t('admin:reports.reopen')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-11"
              onClick={() => {
                void navigator.clipboard?.writeText(fullText).then(() => setCopied(true))
              }}
            >
              <Copy className="size-4" aria-hidden />
              {copied ? t('admin:reports.copied') : t('admin:reports.copy')}
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

function Field({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null
  return (
    <div>
      <p className="mb-0.5 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">{label}</p>
      <pre className={cn('whitespace-pre-wrap break-words text-ink-muted', mono ? 'font-mono text-[11.5px]' : 'font-sans text-[12px]')}>{value}</pre>
    </div>
  )
}
