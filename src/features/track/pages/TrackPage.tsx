import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { useLatestWeight } from '@/features/body'
import { cn } from '@/lib/utils'

/**
 * Track hub. Point of view: the index of a logbook. One ruled surface, one row per log; a live
 * figure on the right where the module exists, a quiet "soon" where it does not.
 */
export function TrackPage({ preview = false }: { preview?: boolean }) {
  const { t, i18n } = useTranslation('track')
  const weight = useLatestWeight()
  const nf = new Intl.NumberFormat(i18n.resolvedLanguage === 'en' ? 'en' : 'tr', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

  const rows = [
    {
      key: 'body',
      to: preview ? '/__dev/track/body' : '/track/body',
      figure: weight.data != null ? `${nf.format(weight.data)} kg` : null,
      empty: t('body.empty'),
    },
    { key: 'nutrition' },
    { key: 'sleepWater' },
    { key: 'photos' },
  ] as const

  return (
    <PageShell title={t('title')} subtitle={t('subtitle')}>
      <ul className="hairline rise-in divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
        {rows.map((r) => {
          const name = t(`${r.key}.name`)
          const body = (
            <>
              <span className="min-w-0 flex-1">
                <span className={cn('display block text-[22px] leading-tight', !('to' in r) && 'text-ink-muted')}>{name}</span>
                <span className="mt-1 block truncate text-[13px] text-ink-faint">{t(`${r.key}.hint`)}</span>
              </span>
              {'to' in r ? (
                <>
                  <span className={cn('tabular shrink-0 text-[17px] font-semibold', r.figure == null && 'text-[14px] font-medium text-volt')}>
                    {r.figure ?? r.empty}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
                </>
              ) : (
                <span className="shrink-0 rounded-full bg-raised px-2.5 py-0.5 text-[11px] font-medium text-ink-muted">{t('soon')}</span>
              )}
            </>
          )
          return (
            <li key={r.key}>
              {'to' in r ? (
                <Link to={r.to} aria-label={t('open', { name })} className="flex min-h-[76px] items-center gap-4 px-5 py-4 hover:bg-raised/50">
                  {body}
                </Link>
              ) : (
                <div className="flex min-h-[76px] items-center gap-4 px-5 py-4">{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </PageShell>
  )
}
