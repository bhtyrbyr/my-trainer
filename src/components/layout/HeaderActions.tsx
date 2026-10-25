import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { avatarUrl } from '@/features/profile/api'

/** Avatar chip (level) + settings gear used in page headers. */
export function HeaderActions() {
  const { t } = useTranslation('common')
  const { profile } = useAuth()
  const src = avatarUrl(profile?.avatar_path, profile?.updated_at)
  return (
    <>
      {profile && (
        <Link
          to="/settings"
          className="flex items-center gap-2 rounded-full bg-slate-900 py-1 pl-1 pr-3 text-xs font-medium text-slate-300"
          aria-label={t('nav.settings')}
        >
          {src ? (
            <img src={src} alt="" className="size-7 rounded-full object-cover" />
          ) : (
            <span className="size-7 rounded-full bg-slate-700" />
          )}
          <span>{t('level', { n: profile.level })}</span>
        </Link>
      )}
      <Link to="/settings" className="touch-target flex items-center justify-center rounded-full text-slate-400 hover:text-slate-100" aria-label={t('nav.settings')}>
        <Settings className="size-5" aria-hidden />
      </Link>
    </>
  )
}
