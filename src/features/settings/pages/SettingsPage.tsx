import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronRight, LogOut, UserCheck } from 'lucide-react'
import { usePendingCount } from '@/features/admin/hooks'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { useAuth } from '@/features/auth/AuthProvider'
import { avatarUrl } from '@/features/profile/api'
import { StreakAvatar } from '@/features/gamification/StreakAvatar'
import { effectiveStreak } from '@/features/gamification/streak'
import { SUPPORTED_LOCALES, type Locale } from '@/lib/i18n'
import { useUserSettings } from '../hooks'
import { cn } from '@/lib/utils'

export function SettingsPage() {
  const { t, i18n } = useTranslation(['settings', 'auth', 'common', 'admin'])
  const { user, profile, signOut } = useAuth()
  const { settings, updateSettings } = useUserSettings()
  const pending = usePendingCount()
  const avatar = avatarUrl(profile?.avatar_path, profile?.updated_at)

  const changeLocale = (locale: Locale) => {
    void i18n.changeLanguage(locale)
    updateSettings.mutate({ locale })
  }

  return (
    <PageShell title={t('settings:title')}>
      <div className="space-y-6">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{t('settings:profile')}</h2>
          <div className="flex items-center gap-4 rounded-xl border border-line bg-surface p-4">
            <StreakAvatar src={avatar} streak={effectiveStreak(profile?.current_streak, profile?.last_active_on)} size={64} />
            <div className="min-w-0">
              <p className="truncate font-semibold">{profile?.display_name}</p>
              <p className="truncate text-sm text-ink-muted">@{profile?.username}</p>
              <p className="text-xs text-ink-faint">
                {t('common:level', { n: profile?.level ?? 1 })} · {t('common:points', { n: profile?.total_points ?? 0 })}
                {profile?.role === 'admin' && <> · {t('settings:admin')}</>}
              </p>
            </div>
          </div>
        </section>

        {profile?.role === 'admin' && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{t('admin:section')}</h2>
            <Link
              to="/admin/requests"
              className="hairline flex items-center gap-3 rounded-xl bg-surface px-4 py-3.5 transition-colors hover:bg-raised"
            >
              <UserCheck className="size-5 text-ink-muted" aria-hidden />
              <span className="flex-1 text-[15px]">{t('admin:requests.link')}</span>
              {(pending.data ?? 0) > 0 && (
                <span className="tabular rounded-full bg-volt px-2 py-0.5 text-xs font-semibold text-volt-ink">{pending.data}</span>
              )}
              <ChevronRight className="size-4 text-ink-faint" aria-hidden />
            </Link>
          </section>
        )}

        <ErrorNote error={updateSettings.error} />

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{t('settings:language')}</h2>
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{t('settings:account')}</h2>
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="text-xs text-ink-muted">{t('settings:signedInAs')}</p>
            <p className="truncate font-medium">{user?.email}</p>
          </div>
          <Button variant="secondary" className="w-full gap-2" onClick={() => void signOut()}>
            <LogOut className="size-5" aria-hidden />
            {t('auth:signOut')}
          </Button>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{t('settings:about')}</h2>
          <p className="text-sm text-ink-muted">{t('settings:attribution')}</p>
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
