import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Tour } from '../components/Tour'
import { tourSteps } from '../logic'

/**
 * /__dev/tour: the first-run tour without persistence. ?step=1..7 opens a slide, ?standalone=1 hides
 * the install step, ?theme=light|dark previews a theme without saving it. Skip/finish restarts.
 */
export function DevTourPreview() {
  const [params] = useSearchParams()
  const [run, setRun] = useState(0)
  const theme = params.get('theme')
  useEffect(() => {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
  }, [theme])
  return (
    <Tour
      key={run}
      steps={tourSteps({ standalone: params.get('standalone') === '1' })}
      initialStep={Math.max(0, Number(params.get('step') ?? 1) - 1)}
      onSkip={() => setRun((r) => r + 1)}
      onDone={() => setRun((r) => r + 1)}
    />
  )
}
