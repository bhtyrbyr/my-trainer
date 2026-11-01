import { useCallback, useState } from 'react'
import { exerciseDbGifUrl, exerciseMedia, type ExerciseMedia } from './media'
import type { Exercise } from './types'

/**
 * GIF URLs that failed to load in this session (offline, removed upstream): every screen skips them and
 * falls back to the illustration frames or the body map, without a retry per list row.
 */
const failedGifs = new Set<string>()

/** The media to show for an exercise plus the `onError` handler for its GIF (ExerciseDB GIF -> frames -> body map). */
export function useExerciseMedia(ex: Partial<Pick<Exercise, 'media_frames' | 'exercisedb_id'>> | null | undefined): {
  media: ExerciseMedia
  onGifError: () => void
} {
  const url = exerciseDbGifUrl(ex?.exercisedb_id)
  const [failedHere, setFailedHere] = useState<string | null>(null)
  const gifFailed = url !== null && (failedHere === url || failedGifs.has(url))
  const onGifError = useCallback(() => {
    if (!url) return
    failedGifs.add(url)
    setFailedHere(url)
  }, [url])
  return { media: exerciseMedia(ex, { gifFailed }), onGifError }
}
