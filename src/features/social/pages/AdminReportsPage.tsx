import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { Flag } from 'lucide-react'
import { BackTitle } from '@/components/layout/BackTitle'
import { PageShell } from '@/components/layout/PageShell'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { SectionTabs } from '@/components/ui/SectionTabs'
import * as api from '../api'
import { parseReport } from '../logic'
import { useAdminReports, useSocialAction } from '../hooks'
import type { AdminReport } from '../schema'
import { EmptyState, ListSkeleton, RowButton } from '../components/parts'

type Target = {
  author_username?: string
  username?: string
  display_name?: string
  name?: string
  kind?: string
  body?: string | null
  bio?: string | null
  description?: string | null
  media?: string[]
}

const STATUSES = ['open', 'resolved'] as const

/** Admin > Reports (/admin/social-reports): the queue, the reported content, resolve or remove the post. */
export function AdminReportsPage() {
  const { t } = useTranslation(['social', 'admin'])
  const [status, setStatus] = useState<'open' | 'resolved'>('open')
  const list = useAdminReports(status)
  const [removing, setRemoving] = useState<AdminReport | null>(null)
  const resolve = useSocialAction((id: string) => api.adminResolveReport(id))
  // admin_remove_post also resolves every open report on that post
  const remove = useSocialAction(
    (r: AdminReport) => api.adminRemovePost(r.target_id!),
    () => setRemoving(null),
  )

  return (
    <PageShell
      title={t('social:admin.title')}
      leading={<BackTitle to="/admin" label={t('admin:section')} title={t('social:admin.title')} />}
    >
      <div className="mx-auto max-w-xl space-y-5 pb-6">
        <SectionTabs
          label={t('social:admin.status')}
          options={STATUSES}
          value={status}
          onChange={setStatus}
          labelOf={(v) => t(`social:admin.${v}`)}
        />
        <ErrorNote error={list.error ?? resolve.error} />
        {list.isLoading ? (
          <ListSkeleton rows={3} tall />
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState icon={Flag} title={t('social:admin.empty')} />
        ) : (
          <ul className="space-y-3">
            {(list.data ?? []).map((r) => {
              const target = (r.target ?? {}) as Target
              const { reason, note } = parseReport(r.reason)
              return (
                <li key={r.id} className="hairline rounded-[var(--radius-card)] bg-surface p-4">
                  <p className="text-[12px] text-ink-faint">
                    {t(`social:admin.kind.${r.target_kind}`)} · @{r.reporter_username ?? '?'} ·{' '}
                    {r.created_at ? format(new Date(r.created_at), 'dd.MM.yyyy HH:mm') : ''}
                  </p>
                  <p className="mt-1 text-[15px] font-semibold">
                    {reason ? t(`social:report.reasons.${reason}`) : t('social:admin.noReason')}
                  </p>
                  {note && <p className="mt-0.5 text-[14px] text-ink-muted">{note}</p>}
                  <div className="mt-3 rounded-[var(--radius-input)] bg-bg/60 p-3 text-[14px]">
                    {r.target ? (
                      <>
                        <p className="font-medium">
                          {target.name ?? target.display_name ?? ''}{' '}
                          {(target.author_username ?? target.username) && (
                            <span className="text-ink-faint">
                              @{target.author_username ?? target.username}
                            </span>
                          )}
                        </p>
                        {(target.body ?? target.bio ?? target.description) && (
                          <p className="mt-1 line-clamp-4 whitespace-pre-line text-ink-muted">
                            {target.body ?? target.bio ?? target.description}
                          </p>
                        )}
                        {target.media && target.media.length > 0 && (
                          <p className="mt-1 text-[12px] text-ink-faint">
                            {t('social:admin.media', { count: target.media.length })}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-ink-faint">{t('social:admin.targetGone')}</p>
                    )}
                  </div>
                  {r.status === 'open' && (
                    <div className="-mb-1 mt-2 flex justify-end">
                      {r.target_kind === 'post' && r.target && (
                        <RowButton tone="danger" onClick={() => setRemoving(r)}>
                          {t('social:admin.removePost')}
                        </RowButton>
                      )}
                      <RowButton
                        tone="primary"
                        disabled={resolve.isPending}
                        onClick={() => resolve.mutate(r.id!)}
                      >
                        {t('social:admin.resolve')}
                      </RowButton>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <ConfirmSheet
        open={removing !== null}
        title={t('social:admin.removeTitle')}
        body={t('social:admin.removeBody')}
        confirmLabel={t('social:admin.removePost')}
        tone="danger"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => removing && remove.mutate(removing)}
        onCancel={() => setRemoving(null)}
      />
    </PageShell>
  )
}
