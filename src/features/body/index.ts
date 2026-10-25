// Public surface of the body feature. Other features import ONLY from here.
import { useBodyMetrics } from './hooks'

export { bodyKeys, useBodyMetrics, usePrivateWeights } from './hooks'
export { bmi, latestWeightOnOrBefore, type BmiCategory } from './logic'
export { MEASURE_FIELDS } from './types'
export type { BodyMetric } from './types'
export { BodyPreviewContext } from './previewContext'

/** Latest logged body weight (kg) or null; shares the body metrics query. */
export function useLatestWeight() {
  const q = useBodyMetrics()
  const latest = q.data?.find((r) => r.weight_kg != null)
  return { ...q, data: latest ? Number(latest.weight_kg) : q.data ? null : undefined }
}
