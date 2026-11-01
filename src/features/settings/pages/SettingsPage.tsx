import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Compass, Info, LogOut, Mail, Scale, Trash2, Trophy, UsersRound } from 'lucide-react'
import { BackTitle } from '@/components/layout/BackTitle'
import { PageShell } from '@/components/layout/PageShell'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { GroupedList, ListRow, Segmented } from '@/components/ui/GroupedList'
import { Switch } from '@/components/ui/Switch'
import { useAuth } from '@/features/auth/AuthProvider'
import { NotificationsSection } from '@/features/notifications/NotificationsSection'
import { DeleteAccountSheet, PrivacySection } from '@/features/privacy/components/PrivacySection'
import { useLeaderboardVisibility } from '@/features/profile/hooks'
import { SUPPORTED_LOCALES, type Locale } from '@/lib/i18n'
import { useSyncState } from '@/lib/offline/hooks'
import { THEMES, applyTheme, readTheme, type ThemePref } from '@/lib/theme'
import { LENGTH_UNITS, WEIGHT_UNITS, asLengthUnit, asWeightUnit } from '@/lib/units'
import { useTour } from '@/features/tour/tourContext'
import { useUserSettings } from '../hooks'

/**
 * Settings (pushed from the Profile hub). iOS inset-grouped: Preferences, Notifications, Privacy and
 * data, Account, About. Every choice is a row; two-to-three-way choices are segmented controls.
 */
export function SettingsPage() {
  const { t, i18n } = useTranslation(['settings', 'auth', 'common', 'legal', 'profile', 'social', 'tour'])
  const tour = useTour()
  const { user, profile, signOut } = useAuth()
  const sync = useSyncState()
  const { settings, updateSettings } = useUserSettings()
  const visibility = useLeaderboardVisibility()
  const [sheet, setSheet] = useState<'signOut' | 'delete' | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const unsynced = sync.pending + sync.failed

  // the account setting is the source of truth (optimistically updated on change); the device copy covers first paint
  const [localTheme, setLocalTheme] = useState<ThemePref>(readTheme)
  const theme: ThemePref = settings?.theme ?? localTheme
  const changeTheme = (next: ThemePref) => {
    setLocalTheme(next)
    applyTheme(next)
    updateSettings.mutate({ theme: next })
  }
  const changeLocale = (locale: Locale) => {
    void i18n.changeLanguage(locale)
    updateSettings.mutate({ locale })
  }
  const locale = (settings?.locale ?? i18n.resolvedLanguage ?? 'tr') as Locale
  const visible = visibility.isPending ? Boolean(visibility.variables) : Boolean(profile?.show_on_leaderboard)

  return (
    <PageShell title={t('settings:title')} leading={<BackTitle to="/me" label={t('profile:title')} title={t('settings:title')} />}>
      <div className="mx-auto max-w-xl space-y-7 pb-6">
        <ErrorNote error={updateSettings.error} />

        <GroupedList title={t('settings:groups.preferences')} footer={t('settings:units.hint')}>
          <PrefRow label={t('settings:language')}>
            <Segmented
              label={t('settings:language')}
              value={locale}
              onChange={changeLocale}
              options={SUPPORTED_LOCALES.map((l) => ({ value: l, label: t(`settings:languages.${l}`) }))}
            />
          </PrefRow>
          <PrefRow label={t('settings:theme.title')}>
            <Segmented
              label={t('settings:theme.title')}
              value={theme}
              onChange={changeTheme}
              options={THEMES.map((th) => ({ value: th, label: t(`settings:theme.${th}`) }))}
            />
          </PrefRow>
          <PrefRow label={t('settings:units.weight')}>
            <Segmented
              label={t('settings:units.weight')}
              value={asWeightUnit(settings?.unit_weight)}
              onChange={(unit_weight) => updateSettings.mutate({ unit_weight })}
              options={WEIGHT_UNITS.map((u) => ({ value: u, label: t(`common:units.${u}`) }))}
            />
          </PrefRow>
          <PrefRow label={t('settings:units.length')}>
            <Segmented
              label={t('settings:units.length')}
              value={asLengthUnit(settings?.unit_length)}
              onChange={(unit_length) => updateSettings.mutate({ unit_length })}
              options={LENGTH_UNITS.map((u) => ({ value: u, label: t(`common:units.${u}`) }))}
            />
          </PrefRow>
        </GroupedList>

        <NotificationsSection />

        <PrivacySection
          leading={
            <>
            <ListRow icon={UsersRound} label={t('social:settings.title')} hint={t('social:settings.rowHint')} to="/settings/social" />
            <ListRow
              icon={Trophy}
              label={t('settings:leaderboard.label')}
              hint={t('settings:leaderboard.hint')}
              className="py-1.5 pr-2"
              trailing={
                <Switch
                  checked={visible}
                  disabled={!profile || visibility.isPending}
                  label={t('settings:leaderboard.label')}
                  onChange={(next) => visibility.mutate(next)}
                />
              }
            />
            </>
          }
        />
        <ErrorNote error={visibility.error} />

        <GroupedList title={t('settings:account')}>
          <ListRow icon={Mail} label={t('settings:email')} value={user?.email} />
          <ListRow icon={LogOut} label={t('auth:signOut')} destructive chevron={false} onClick={() => setSheet('signOut')} />
          <ListRow icon={Trash2} label={t('legal:settings.delete')} destructive chevron={false} onClick={() => setSheet('delete')} />
        </GroupedList>

        <GroupedList title={t('settings:about')}>
          <ListRow icon={Compass} label={t('tour:replay')} hint={t('tour:replayHint')} onClick={tour.open} />
          <ListRow icon={Scale} label={t('settings:licenses.link')} hint={t('settings:licenses.hint')} to="/settings/licenses" />
          <ListRow
            icon={Info}
            label={t('settings:versionLabel')}
            value={<span className="tabular">{`${__APP_VERSION__} · ${__APP_COMMIT__}`}</span>}
          />
        </GroupedList>
      </div>

      <ConfirmSheet
        open={sheet === 'signOut'}
        title={t('settings:signOut.title')}
        body={unsynced > 0 ? t('settings:signOutUnsynced', { count: unsynced }) : t('settings:signOut.body')}
        confirmLabel={t('auth:signOut')}
        tone="danger"
        pending={signingOut}
        onConfirm={() => {
          setSigningOut(true)
          void signOut().finally(() => setSigningOut(false))
        }}
        onCancel={() => setSheet(null)}
      />
      <DeleteAccountSheet open={sheet === 'delete'} onClose={() => setSheet(null)} />
    </PageShell>
  )
}

/** Label on the left, a segmented control on the right; stacks under the label when space runs out. */
function PrefRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
      <span className="text-[15px] text-ink">{label}</span>
      <div className="min-w-[180px] max-w-full flex-1 sm:max-w-[260px] sm:flex-none">{children}</div>
    </div>
  )
}
