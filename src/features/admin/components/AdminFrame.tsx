import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'

/** Admin sub-page frame: back to the admin hub on the left of the title. */
export function AdminFrame({
  title,
  children,
  back = '/admin',
}: {
  title: string
  children: ReactNode
  back?: string
}) {
  const { t } = useTranslation('admin')
  return (
    <PageShell
      title={title}
      leading={
        <div className="flex items-center gap-1">
          <Link
            to={back}
            aria-label={t('back')}
            className="-ml-2 flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <span className="truncate text-lg font-bold tracking-tight">{title}</span>
        </div>
      }
    >
      <div className="mx-auto max-w-2xl pb-6">{children}</div>
    </PageShell>
  )
}

export { Switch } from '@/components/ui/Switch'
