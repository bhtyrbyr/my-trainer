import { useTranslation } from 'react-i18next'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { cn } from '@/lib/utils'
import { AdminFrame } from '../components/AdminFrame'
import { useUsageSummary } from '../hooks'
import { formatBytes, usageMeters, type Meter } from '../usageLogic'

/** Free-tier headroom: database, storage and Edge Function calls against the Supabase Free limits. */
export function UsagePage() {
  const { t, i18n } = useTranslation('admin')
  const summary = useUsageSummary()
  const s = summary.data
  const meters = s ? usageMeters(s) : []
  const top = meters.reduce<Meter | null>((a, m) => (!a || m.ratio > a.ratio ? m : a), null)
  const pct = (r: number) => new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: r < 0.1 ? 1 : 0 }).format(r)
  const amount = (m: Meter) =>
    m.key === 'edge'
      ? `${new Intl.NumberFormat(i18n.language).format(m.used)} / ${new Intl.NumberFormat(i18n.language).format(m.limit)}`
      : `${formatBytes(m.used, i18n.language)} / ${formatBytes(m.limit, i18n.language)}`

  return (
    <AdminFrame title={t('usage.title')}>
      <ErrorNote error={summary.error} />
      {s && top && (
        <div className="rise-in space-y-8">
          <header className="space-y-1 pt-2">
            <p className="eyebrow">{t('usage.highest')}</p>
            <p className="display tabular text-[56px] leading-none">{pct(top.ratio)}</p>
            <p className="text-[15px] text-ink-muted">{t(`usage.meter.${top.key}`)}</p>
          </header>

          <ul className="space-y-6">
            {meters.map((m) => (
              <li key={m.key} className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[15px] font-medium">{t(`usage.meter.${m.key}`)}</span>
                  <span className="tabular text-[13px] text-ink-muted">{amount(m)}</span>
                </div>
                <div
                  role="meter"
                  aria-label={t(`usage.meter.${m.key}`)}
                  aria-valuenow={Math.round(m.ratio * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1.5 overflow-hidden rounded-full bg-raised"
                >
                  <div
                    className={cn('h-full rounded-full', m.ratio >= 0.8 ? 'bg-danger' : 'bg-volt')}
                    style={{ width: `${Math.max(m.ratio * 100, m.used > 0 ? 1 : 0)}%` }}
                  />
                </div>
                {m.key === 'storage' && Object.keys(s.storage).length > 0 && (
                  <p className="tabular text-[13px] text-ink-faint">
                    {Object.entries(s.storage)
                      .sort((a, b) => b[1] - a[1])
                      .map(([bucket, bytes]) => `${t(`usage.bucket.${bucket}`, { defaultValue: bucket })} ${formatBytes(bytes, i18n.language)}`)
                      .join(' · ')}
                  </p>
                )}
                {m.key === 'edge' && <p className="text-[13px] text-ink-faint">{t('usage.edgeNote')}</p>}
              </li>
            ))}
          </ul>

          <div className="space-y-1 border-t border-line pt-5">
            <p className="text-[15px] font-medium">{t('usage.users', { count: s.usersTotal })}</p>
            <p className="text-[13px] text-ink-muted">{t('usage.active', { count: s.usersActive7d })}</p>
          </div>

          <p className="text-[13px] leading-relaxed text-ink-faint">{t('usage.footer')}</p>
        </div>
      )}
    </AdminFrame>
  )
}
