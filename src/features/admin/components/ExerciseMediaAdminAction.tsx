import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Film } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCanEditExerciseMedia } from '../hooks'
import type { PickerExercise } from './ExerciseMediaPicker'

// admin-only code: loaded on the first tap, never for other users
const ExerciseMediaPicker = lazy(() => import('./ExerciseMediaPicker').then((m) => ({ default: m.ExerciseMediaPicker })))

/**
 * "Change animation" / "Choose animation" on the exercise page, for admins only (renders nothing for
 * everyone else). A quiet text action; the picker it opens also offers "Remove animation".
 */
export function ExerciseMediaAdminAction({ exercise, className }: { exercise: PickerExercise & { source?: string; is_custom?: boolean }; className?: string }) {
  const { t } = useTranslation('exercises')
  const canEdit = useCanEditExerciseMedia()
  const [open, setOpen] = useState(false)
  // only catalog rows take an ExerciseDB animation (the RPC refuses custom and legacy rows)
  if (!canEdit || exercise.is_custom || (exercise.source !== undefined && exercise.source !== 'wger' && exercise.source !== 'workout-guide')) return null
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-button)] px-2 text-[13px] font-medium text-ink-muted transition-colors hover:bg-raised hover:text-ink',
          className,
        )}
      >
        <Film className="size-3.5" aria-hidden />
        {t(exercise.exercisedb_id ? 'detail.changeAnimation' : 'detail.chooseAnimation')}
      </button>
      {open && (
        <Suspense fallback={null}>
          <ExerciseMediaPicker exercise={exercise} onClose={() => setOpen(false)} showOpenLink={false} />
        </Suspense>
      )}
    </>
  )
}
