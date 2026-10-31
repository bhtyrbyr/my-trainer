import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Bug, ChevronRight, DoorOpen, Gauge, LogOut, Scale, Sparkles, UserCheck, Users } from 'lucide-react'
import { useAdminConfig, useAiLive, useErrorReports, usePendingCount } from '@/features/admin/hooks'
import { BadgeShelf } from '@/features/badges'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { useAuth } from '@/features/auth/AuthProvider'
import { avatarUrl } from '@/features/profile/api'
import { StreakAvatar } from '@/features/gamification/StreakAvatar'
import { effectiveStreak } from '@/features/gamification/streak'
import { SUPPORTED_LOCALES, type Locale } from '@/lib/i18n'
import { THEMES, applyTheme, readTheme, type ThemePref } from '@/lib/theme'
import { LENGTH_UNITS, WEIGHT_UNITS, asLengthUnit, asWeightUnit, type LengthUnit, type WeightUnit } from '@/lib/units'
import { useUserSettings } from '../hooks'
import { useSyncState } from '@/lib/offline/hooks'
import { PrivacySection } from '@/features/privacy/components/PrivacySection'
import { NotificationsSection } from '@/features/notifications/NotificationsSection'
import { cn } from '@/lib/utils'

export function SettingsPage() {
  const { t, i18n } = useTranslation(['settings', 'auth', 'common', 'admin', 'coach'])
  const { user, profile, signOut } = useAuth()
  const sync = useSyncState()
  const { settings, updateSettings } = useUserSettings()
  const pending = usePendingCount()
  const aiLive = useAiLive()
  const openReports = useErrorReports('open')
  const access = useAdminConfig()
  const aiToday = (aiLive.data ?? []).reduce((s, m) => s + m.requests_today, 0)
  const avatar = avatarUrl(profile?.avatar_path, profile?.updated_at)

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

  return (
    <PageShell title={t('settings:title')}>
      <div className="space-y-6">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            {t('settings:profile')}
          </h2>
          <div className="flex items-center gap-4 rounded-xl border border-line bg-surface p-4">
            <StreakAvatar
              src={avatar}
              streak={effectiveStreak(profile?.current_streak, profile?.last_active_on)}
              size={64}
            />
            <div className="min-w-0">
              <p className="truncate font-semibold">{profile?.display_name}</p>
              <p className="truncate text-sm text-ink-muted">@{profile?.username}</p>
              <p className="text-xs text-ink-faint">
                {t('common:level', { n: profile?.level ?? 1 })} ·{' '}
                {t('common:points', { n: profile?.total_points ?? 0 })}
                {profile?.role === 'admin' && <> · {t('settings:admin')}</>}
              </p>
            </div>
          </div>
        </section>

        <BadgeShelf />

        <Link
          to="/coach"
          className="hairline flex items-center gap-3 rounded-xl bg-surface px-4 py-3.5 transition-colors hover:bg-raised"
        >
          <Sparkles className="size-5 text-volt" aria-hidden />
          <span className="flex-1">
            <span className="block text-[15px]">{t('coach:settings.link')}</span>
            <span className="block text-[12px] leading-snug text-ink-faint">{t('coach:settings.hint')}</span>
          </span>
          <ChevronRight className="size-4 text-ink-faint" aria-hidden />
        </Link>

        {profile?.role === 'admin' && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
              {t('admin:section')}
            </h2>
            <Link
              to="/admin/requests"
              className="hairline flex items-center gap-3 rounded-xl bg-surface px-4 py-3.5 transition-colors hover:bg-raised"
            >
              <UserCheck className="size-5 text-ink-muted" aria-hidden />
              <span className="flex-1 text-[15px]">{t('admin:requests.link')}</span>
              {(pending.data ?? 0) > 0 && (
                <span className="tabular rounded-full bg-volt px-2 py-0.5 text-xs font-semibold text-volt-ink">
                  {pending.data}
                </span>
              )}
              <ChevronRight className="size-4 text-ink-faint" aria-hidden />
            </Link>
            <Link
              to="/admin/access"
              className="hairline flex items-center gap-3 rounded-xl bg-surface px-4 py-3.5 transition-colors hover:bg-raised"
            >
              <DoorOpen className="size-5 text-ink-muted" aria-hidden />
              <span className="flex-1 text-[15px]">{t('admin:access.link')}</span>
              {access.data && (
                <span className="text-xs text-ink-faint">
                  {access.data.access_mode === 'invite' ? t('admin:access.linkInvite') : t('admin:access.linkOpen')}
                </span>
              )}
              <ChevronRight className="size-4 text-ink-faint" aria-hidden />
            </Link>
            <Link
              to="/admin/users"
              className="hairline flex items-center gap-3 rounded-xl bg-surface px-4 py-3.5 transition-colors hover:bg-raised"
            >
              <Users className="size-5 text-ink-muted" aria-hidden />
              <span className="flex-1 text-[15px]">{t('admin:users.link')}</span>
              <ChevronRight className="size-4 text-ink-faint" aria-hidden />
            </Link>
            <Link
              to="/admin/error-reports"
              className="hairline flex items-center gap-3 rounded-xl bg-surface px-4 py-3.5 transition-colors hover:bg-raised"
            >
              <Bug className="size-5 text-ink-muted" aria-hidden />
              <span className="flex-1 text-[15px]">{t('admin:reports.link')}</span>
              {(openReports.data?.length ?? 0) > 0 && (
                <span className="tabular rounded-full bg-danger px-2 py-0.5 text-xs font-semibold text-ink">
                  {openReports.data?.length}
                </span>
              )}
              <ChevronRight className="size-4 text-ink-faint" aria-hidden />
            </Link>
            <Link
              to="/admin/ai-usage"
              className="hairline flex items-center gap-3 rounded-xl bg-surface px-4 py-3.5 transition-colors hover:bg-raised"
            >
              <Sparkles className="size-5 text-ink-muted" aria-hidden />
              <span className="flex-1 text-[15px]">{t('admin:ai.link')}</span>
              {aiLive.data && (
                <span className="tabular text-xs text-ink-faint">
                  {t('admin:ai.linkToday', { count: aiToday })}
                </span>
              )}
              <ChevronRight className="size-4 text-ink-faint" aria-hidden />
            </Link>
            <Link
              to="/admin/usage"
              className="hairline flex items-center gap-3 rounded-xl bg-surface px-4 py-3.5 transition-colors hover:bg-raised"
            >
              <Gauge className="size-5 text-ink-muted" aria-hidden />
              <span className="flex-1 text-[15px]">{t('admin:usage.link')}</span>
              <ChevronRight className="size-4 text-ink-faint" aria-hidden />
            </Link>
          </section>
        )}

        <ErrorNote error={updateSettings.error} />

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            {t('settings:language')}
          </h2>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('settings:language')}>
            {SUPPORTED_LOCALES.map((loc) => {
              const active = (settings?.locale ?? i18n.resolvedLanguage) === loc
              return (
                <button
                  key={loc}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => changeLocale(loc)}
                  className={cn(
                    'touch-target rounded-xl border px-4 py-3 text-left font-medium transition-colors',
                    active ? 'border-volt bg-volt/10 text-volt' : 'border-line bg-surface text-ink',
                  )}
                >
                  {t(`settings:languages.${loc}`)}
                </button>
              )
            })}
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            {t('settings:theme.title')}
          </h2>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('settings:theme.title')}>
            {THEMES.map((th) => {
              const active = theme === th
              return (
                <button
                  key={th}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => changeTheme(th)}
                  className={cn(
                    'touch-target flex flex-col items-start gap-2 rounded-xl border px-3 py-3 text-left font-medium transition-colors',
                    active ? 'border-volt bg-volt/10 text-volt' : 'border-line bg-surface text-ink',
                  )}
                >
                  <ThemeSwatch kind={th} />
                  <span className="text-[14px]">{t(`settings:theme.${th}`)}</span>
                </button>
              )
            })}
          </div>
          <p className="text-[12px] text-ink-faint">{t('settings:theme.hint')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            {t('settings:units.title')}
          </h2>
          <UnitChoice
            label={t('settings:units.weight')}
            options={WEIGHT_UNITS}
            value={asWeightUnit(settings?.unit_weight)}
            onChange={(unit_weight: WeightUnit) => updateSettings.mutate({ unit_weight })}
          />
          <UnitChoice
            label={t('settings:units.length')}
            options={LENGTH_UNITS}
            value={asLengthUnit(settings?.unit_length)}
            onChange={(unit_length: LengthUnit) => updateSettings.mutate({ unit_length })}
          />
          <p className="text-[12px] text-ink-faint">{t('settings:units.hint')}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            {t('settings:account')}
          </h2>
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="text-xs text-ink-muted">{t('settings:signedInAs')}</p>
            <p className="truncate font-medium">{user?.email}</p>
          </div>
          <Button
            variant="secondary"
            className="w-full gap-2"
            onClick={() => {
              // unsynced offline writes are dropped on sign-out: ask first
              if (sync.pending + sync.failed > 0 && !window.confirm(t('settings:signOutUnsynced', { count: sync.pending + sync.failed }))) return
              void signOut()
            }}
          >
            <LogOut className="size-5" aria-hidden />
            {t('auth:signOut')}
          </Button>
        </section>

        <NotificationsSection />

        <PrivacySection />

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            {t('settings:about')}
          </h2>
          <Link
            to="/settings/licenses"
            className="hairline flex items-center gap-3 rounded-xl bg-surface px-4 py-3.5 transition-colors hover:bg-raised"
          >
            <Scale className="size-5 text-ink-muted" aria-hidden />
            <span className="flex-1">
              <span className="block text-[15px]">{t('settings:licenses.link')}</span>
              <span className="block text-[12px] leading-snug text-ink-faint">{t('settings:licenses.hint')}</span>
            </span>
            <ChevronRight className="size-4 text-ink-faint" aria-hidden />
          </Link>
          <p className="tabular text-xs text-ink-faint">
            {t('settings:version', { version: __APP_VERSION__ })}
            <span className="text-ink-faint/60"> · </span>
            <a
              href={`https://github.com/bhtyrbyr/my-trainer/commit/${__APP_COMMIT__}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono hover:text-ink-muted"
              title={t('settings:commit')}
            >
              {__APP_COMMIT__}
            </a>
          </p>
        </section>
      </div>
    </PageShell>
  )
}

/** Two-way unit picker: the symbol carries the choice, the full name sits under it. */
function UnitChoice<U extends WeightUnit | LengthUnit>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly U[]
  value: U
  onChange: (unit: U) => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <div>
      <p className="eyebrow mb-1.5">{label}</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={label}>
        {options.map((unit) => {
          const active = value === unit
          return (
            <button
              key={unit}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => !active && onChange(unit)}
              className={cn(
                'touch-target flex items-baseline justify-between gap-2 rounded-xl border px-4 py-3 text-left transition-colors',
                active ? 'border-volt bg-volt/10 text-volt' : 'border-line bg-surface text-ink',
              )}
            >
              <span className="font-medium">{t(`settings:units.${unit}`)}</span>
              <span className={cn('tabular text-[13px]', active ? 'text-volt/80' : 'text-ink-faint')}>
                {t(`common:units.${unit}`)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Tiny preview chip: a page with a line of text and an accent dot, in each theme's own colours. */
function ThemeSwatch({ kind }: { kind: ThemePref }) {
  const dark = { bg: '#111309', ink: '#eceee6', accent: '#c6f432' }
  const light = { bg: '#f5f6f0', ink: '#22261c', accent: '#4f8a12' }
  const half = (c: typeof dark) => (
    <span className="flex flex-1 flex-col justify-center gap-1 px-1.5" style={{ background: c.bg }}>
      <span className="h-1 w-6 rounded-full" style={{ background: c.ink, opacity: 0.85 }} />
      <span className="size-1.5 rounded-full" style={{ background: c.accent }} />
    </span>
  )
  return (
    <span aria-hidden className="hairline flex h-9 w-full overflow-hidden rounded-md">
      {kind === 'light' ? (
        half(light)
      ) : kind === 'dark' ? (
        half(dark)
      ) : (
        <>
          {half(light)}
          {half(dark)}
        </>
      )}
    </span>
  )
}
