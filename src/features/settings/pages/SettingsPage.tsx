import { useTranslation } from 'react-i18next'
import { LogOut } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/AuthProvider'
import { avatarUrl } from '@/features/profile/api'
import { SUPPORTED_LOCALES, type Locale } from '@/lib/i18n'
import { useUserSettings } from '../hooks'
import { cn } from '@/lib/utils'

export function SettingsPage() {
  const { t, i18n } = useTranslation(['settings', 'auth', 'common'])
  const { user, profile, signOut } = useAuth()
  const { settings, updateSettings } = useUserSettings()
  const avatar = avatarUrl(profile?.avatar_path, profile?.updated_at)

  const changeLocale = (locale: Locale) => {
    void i18n.changeLanguage(locale)
    updateSettings.mutate({ locale })
  }

  return (
    <PageShell title={t('settings:title')}>
      <div className="space-y-6">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{t('settings:profile')}</h2>
          <div className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
            {avatar ? (
              <img src={avatar} alt="" className="size-14 rounded-full object-cover" />
            ) : (
              <span className="size-14 rounded-full bg-slate-700" />
            )}
            <div className="min-w-0">
              <p className="truncate font-semibold">{profile?.display_name}</p>
              <p className="truncate text-sm text-slate-400">@{profile?.username}</p>
              <p className="text-xs text-slate-500">
                {t('common:level', { n: profile?.level ?? 1 })} · {t('common:points', { n: profile?.total_points ?? 0 })}
                {profile?.role === 'admin' && <> · {t('settings:admin')}</>}
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{t('settings:language')}</h2>
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
                    active ? 'border-brand-500 bg-brand-500/10 text-brand-400' : 'border-slate-800 bg-slate-900 text-slate-200',
                  )}
                >
                  {t(`settings:languages.${loc}`)}
                </button>
              )
            })}
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{t('settings:account')}</h2>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs text-slate-400">{t('settings:signedInAs')}</p>
            <p className="truncate font-medium">{user?.email}</p>
          </div>
          <Button variant="secondary" className="w-full gap-2" onClick={() => void signOut()}>
            <LogOut className="size-5" aria-hidden />
            {t('auth:signOut')}
          </Button>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{t('settings:about')}</h2>
          <p className="text-sm text-slate-400">{t('settings:attribution')}</p>
          <p className="text-xs text-slate-500">{t('settings:version', { version: __APP_VERSION__ })}</p>
        </section>
      </div>
    </PageShell>
  )
}
