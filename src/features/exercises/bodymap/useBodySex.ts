import { useProfilePrivate } from '@/features/profile/hooks'
import type { BodySex } from './types'

/**
 * Which figure to draw for the signed-in user: female for `profile_private.sex = 'female'`, male for
 * anything else or unknown. `pending` only while the first fetch is in flight (not while offline-paused),
 * so a female user does not see the male figure flash first.
 */
export function useBodySex(): { sex: BodySex; pending: boolean } {
  const q = useProfilePrivate()
  return { sex: q.data?.sex === 'female' ? 'female' : 'male', pending: q.isLoading }
}
