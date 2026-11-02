// DEV ONLY: sample ExerciseDB search hits for the picker previews (/__dev/admin/exercisedb and
// /__dev/exercises/<id>?admin=1). Real ids and names, so the hot-linked GIFs load; no Edge Function call.
import type { QueryClient } from '@tanstack/react-query'
import type { ExerciseDbHit } from '../exercisedbLogic'
import { adminKeys } from '../hooks'

export const SAMPLE_HITS: ExerciseDbHit[] = [
  { id: 'EIeI8Vf', name: 'barbell bench press' },
  { id: 'J6Dx1Mu', name: 'barbell close-grip bench press' },
  { id: 'GrO65fd', name: 'barbell decline bench press' },
  { id: '3TZduzM', name: 'barbell incline bench press' },
  { id: 'trqKQv2', name: 'smith bench press' },
]

/** Every search in the preview answers with SAMPLE_HITS (useExerciseDbSearch reads this key there). */
export function seedExerciseDbSearch(qc: QueryClient) {
  qc.setQueryData(adminKeys.exercisedbSearchSample, SAMPLE_HITS)
}
