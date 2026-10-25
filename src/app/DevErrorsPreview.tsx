import { ErrorNote } from '@/components/ui/ErrorNote'

/** Dev-only: how the error note looks for a user-fixable error and for one that offers "report to admin". */
export function DevErrorsPreview() {
  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pt-safe">
      <ErrorNote error={{ code: '23514', message: 'new row violates check constraint "x"' }} />
      <ErrorNote error={{ code: 'XX000', message: 'internal error' }} />
      <ErrorNote error={{ status: 503, message: 'Service unavailable' }} />
    </div>
  )
}
