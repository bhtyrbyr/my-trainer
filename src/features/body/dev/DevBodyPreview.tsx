import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from '@/app/AppShell'
import { TrackPage } from '@/features/track/pages/TrackPage'
import { toLocalDateISO } from '@/lib/dates'
import { bodyKeys } from '../hooks'
import { BodyPage } from '../pages/BodyPage'
import { BodyPreviewContext } from '../previewContext'
import type { BodyMetric } from '../types'

/** ~3 months of noisy weigh-ins drifting from 86 to 82 kg, with a few weekly measurements. ?empty=1 for a fresh user. */
function sampleRows(): BodyMetric[] {
  const rows: BodyMetric[] = []
  const today = new Date()
  for (let i = 92; i >= 1; i--) {
    if (i % 3 === 1 && i > 10) continue
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const trend = 82 + (4 * i) / 92
    const noise = Math.sin(i * 1.7) * 0.6 + Math.cos(i * 0.9) * 0.3
    const weekly = i % 7 === 2
    const day = toLocalDateISO(d)
    rows.push({
      id: `s-${day}`,
      user_id: 'preview',
      measured_on: day,
      weight_kg: Math.round((trend + noise) * 10) / 10,
      waist_cm: weekly ? Math.round((88 + i / 15) * 2) / 2 : null,
      chest_cm: weekly && i % 14 === 2 ? 102 : null,
      arm_cm: weekly ? 35.5 : null,
      hip_cm: null,
      thigh_cm: weekly && i < 40 ? 58 : null,
      note: null,
      created_at: d.toISOString(),
      updated_at: d.toISOString(),
    })
  }
  return rows.reverse()
}

function seed(empty: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  qc.setQueryData(bodyKeys.metrics, empty ? [] : sampleRows())
  qc.setQueryData(bodyKeys.target, { target: empty ? null : 78, start: empty ? 84 : 86 })
  return qc
}

export function DevBodyLayout() {
  const [params] = useSearchParams()
  const [client] = useState(() => seed(params.get('empty') === '1'))
  return (
    <QueryClientProvider client={client}>
      <BodyPreviewContext.Provider value={true}>
        <AppShell />
      </BodyPreviewContext.Provider>
    </QueryClientProvider>
  )
}

export function DevTrack() {
  return <TrackPage preview />
}

export function DevBody() {
  return <BodyPage />
}
