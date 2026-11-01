import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { FullScreenSpinner } from '@/components/layout/FullScreenSpinner'
import { useUserSettings } from '@/features/settings/hooks'
import { isStandalone, shouldShowTour, tourSteps } from '../logic'
import { TourContext } from '../tourContext'
import { Tour } from './Tour'

/**
 * Sits inside RequireAuth + NoticeGate: an approved, onboarded user who has acknowledged the notice
 * sees the tour once (user_settings.tour_completed_at is null). Skip or finish stamps the column.
 * Also provides `useTour().open()` for the "watch the tour again" row in Settings.
 */
export function TourGate({ children }: { children: ReactNode }) {
  const { settings, isLoading, updateSettings } = useUserSettings()
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(false)
  const [replay, setReplay] = useState(false)
  const ctx = useMemo(() => ({ open: () => setReplay(true) }), [])

  if (isLoading) return <FullScreenSpinner />

  const show = replay || shouldShowTour(settings, dismissed)
  const close = (home: boolean) => {
    setDismissed(true)
    setReplay(false)
    if (settings && settings.tour_completed_at === null)
      updateSettings.mutate({ tour_completed_at: new Date().toISOString() })
    if (home) navigate('/')
  }

  return (
    <TourContext.Provider value={ctx}>
      {show ? (
        <Tour
          steps={tourSteps({ standalone: isStandalone() })}
          onSkip={() => close(false)}
          onDone={() => close(true)}
        />
      ) : (
        children
      )}
    </TourContext.Provider>
  )
}
