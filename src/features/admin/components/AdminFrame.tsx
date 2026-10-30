import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { cn } from '@/lib/utils'

/** Admin sub-page frame: back to Profile on the left of the title, same as the AI usage page. */
export function AdminFrame({
  title,
  children,
  back = '/settings',
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

/** iOS-style switch with a 44 px hit area; volt track when on. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex h-11 w-[60px] shrink-0 items-center justify-center disabled:opacity-50"
    >
      <span
        className={cn(
          'relative h-[30px] w-[50px] rounded-full transition-colors duration-200',
          checked ? 'bg-volt' : 'bg-raised ring-1 ring-inset ring-line-strong',
        )}
      >
        <span
          className={cn(
            'absolute top-[3px] size-6 rounded-full transition-[left,background-color] duration-200',
            checked ? 'left-[23px] bg-volt-ink' : 'left-[3px] bg-ink-muted',
          )}
        />
      </span>
    </button>
  )
}
