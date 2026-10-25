// Public surface of the body feature. Other features import ONLY from here.
import { useBodyMetrics } from './hooks'

export { bodyKeys } from './hooks'
export { BodyPreviewContext } from './previewContext'

/** Latest logged body weight (kg) or null; shares the body metrics query. */
export function useLatestWeight() {
  const q = useBodyMetrics()
  const latest = q.data?.find((r) => r.weight_kg != null)
  return { ...q, data: latest ? Number(latest.weight_kg) : q.data ? null : undefined }
}
