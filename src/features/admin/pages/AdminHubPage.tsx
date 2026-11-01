import { useTranslation } from 'react-i18next'
import { Bug, DoorOpen, Flag, Gauge, Sparkles, UserCheck, Users } from 'lucide-react'
import { BackTitle } from '@/components/layout/BackTitle'
import { PageShell } from '@/components/layout/PageShell'
import { GroupedList, ListRow } from '@/components/ui/GroupedList'
import { useAdminReports } from '@/features/social/hooks'
import { useAdminConfig, useAiLive, useErrorReports, usePendingCount } from '../hooks'

/** Admin hub (/admin): one grouped list of the admin screens, with live counts where they matter. */
export function AdminHubPage() {
  const { t } = useTranslation(['admin', 'settings', 'social'])
  const socialReports = useAdminReports('open')
  const pending = usePendingCount()
  const openReports = useErrorReports('open')
  const access = useAdminConfig()
  const aiLive = useAiLive()
  const aiToday = (aiLive.data ?? []).reduce((s, m) => s + m.requests_today, 0)

  return (
    <PageShell title={t('admin:section')} leading={<BackTitle to="/settings" label={t('settings:title')} title={t('admin:section')} />}>
      <div className="mx-auto max-w-xl space-y-7 pb-6">
        <GroupedList title={t('admin:hub.people')}>
          <ListRow icon={UserCheck} label={t('admin:requests.link')} to="/admin/requests" badge={pending.data ?? 0} />
          <ListRow
            icon={DoorOpen}
            label={t('admin:access.link')}
            to="/admin/access"
            value={access.data ? (access.data.access_mode === 'invite' ? t('admin:access.linkInvite') : t('admin:access.linkOpen')) : undefined}
          />
          <ListRow icon={Users} label={t('admin:users.link')} to="/admin/users" />
          <ListRow icon={Flag} label={t('social:admin.title')} to="/admin/social-reports" badge={socialReports.data?.length ?? 0} badgeTone="danger" />
        </GroupedList>
        <GroupedList title={t('admin:hub.system')}>
          <ListRow icon={Bug} label={t('admin:reports.link')} to="/admin/error-reports" badge={openReports.data?.length ?? 0} badgeTone="danger" />
          <ListRow
            icon={Sparkles}
            label={t('admin:ai.link')}
            to="/admin/ai-usage"
            value={aiLive.data ? <span className="tabular">{t('admin:ai.linkToday', { count: aiToday })}</span> : undefined}
          />
          <ListRow icon={Gauge} label={t('admin:usage.link')} to="/admin/usage" />
        </GroupedList>
      </div>
    </PageShell>
  )
}
