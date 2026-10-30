import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { NoticeContent } from '../components/NoticeContent'

/** /privacy: public (no sign-in needed), linked from the login page, onboarding and settings. */
export function PrivacyNoticePage() {
  const { t } = useTranslation('legal')
  const navigate = useNavigate()
  return (
    <div className="bg-atmosphere min-h-dvh">
      <div className="mx-auto max-w-2xl px-5 pb-16 pt-safe">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          className="-ml-2 mt-3 flex h-11 items-center gap-1.5 rounded-full px-2 text-[14px] font-medium text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-5" aria-hidden />
          {t('notice.back')}
        </button>
        <div className="mt-4">
          <NoticeContent />
        </div>
      </div>
    </div>
  )
}
