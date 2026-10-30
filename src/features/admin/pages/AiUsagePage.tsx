import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { format, formatDistanceStrict, parseISO } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { ArrowLeft, Loader2, Pencil, SlidersHorizontal } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { cn } from '@/lib/utils'
import { QUOTA_TZ, dailySeries, nextMidnight, type ModelLimits, type UsageRow } from '../aiUsageLogic'
import { useAiAppToday, useAiLive, useAiModelLimits, useAiUsage, useSetAdminConfig, useSetAiModelLimits } from '../hooks'
import { LIMITS, parseLimit } from '../adminLogic'

const PERIODS = [7, 30, 90] as const
type Metric = 'tokens' | 'requests'

/**
 * Admin AI usage. Point of view: a meter, a trend and a ledger. Today's Google quota per model is
 * the headline (bars against the limits the admin copied from AI Studio, with the Pacific reset);
 * the trend shows intensity; the ledger answers "who, when, how much". Counts only, no content.
 */
export function AiUsagePage() {
  const { t, i18n } = useTranslation('admin')
  const lang = i18n.resolvedLanguage === 'en' ? 'en' : 'tr'
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30)
  const [metric, setMetric] = useState<Metric>('tokens')
  const [editing, setEditing] = useState(false)
  const [editingGlobal, setEditingGlobal] = useState(false)
  const usage = useAiUsage(days)
  const live = useAiLive()
  const app = useAiAppToday()
  const limits = useAiModelLimits()
  const nf = useMemo(() => new Intl.NumberFormat(lang), [lang])
  const compact = useMemo(() => compactFormatter(lang), [lang])

  const rows = useMemo(() => (usage.data ?? []) as UsageRow[], [usage.data])
  const series = useMemo(() => dailySeries(rows, days), [rows, days])
  const models = useMemo(() => {
    const set = new Set<string>(Object.keys(limits.data ?? {}))
    for (const l of live.data ?? []) set.add(l.model)
    return [...set]
  }, [limits.data, live.data])

  return (
    <PageShell
      title={t('ai.title')}
      leading={
        <div className="flex items-center gap-1">
          <Link to="/settings" aria-label={t('ai.back')} className="-ml-2 flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink">
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <span className="text-lg font-bold tracking-tight">{t('ai.title')}</span>
        </div>
      }
    >
      <div className="mx-auto max-w-3xl space-y-10 pb-6">
        <ErrorNote error={usage.error ?? live.error ?? limits.error ?? app.error} />

        <section aria-labelledby="quota-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="quota-title" className="display text-[22px]">
              {t('ai.quota.title')}
            </h2>
            <Button variant="ghost" size="icon" aria-label={t('ai.quota.editLimits')} title={t('ai.quota.editLimits')} onClick={() => setEditing(true)}>
              <SlidersHorizontal className="size-5" aria-hidden />
            </Button>
          </div>
          <ResetLine lang={lang} />
          <ul className="hairline mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
            {models.map((m) => {
              const lim = limits.data?.[m]
              const l = live.data?.find((x) => x.model === m)
              const used = l?.requests_today ?? 0
              const pct = lim?.rpd ? Math.min(100, (used / lim.rpd) * 100) : 0
              return (
                <li key={m} className="px-4 py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-mono text-[13px] text-ink-muted">{m}</span>
                    <span className="tabular shrink-0 text-[12px] text-ink-faint">
                      {nf.format(l?.tokens_today ?? 0)} {t('ai.quota.tokens')}
                    </span>
                  </div>
                  <p className="mt-2 flex items-baseline gap-1.5">
                    <span className="display tabular text-[34px] leading-none">{nf.format(used)}</span>
                    <span className="text-[13px] text-ink-muted">{lim?.rpd ? t('ai.quota.perDay', { n: nf.format(lim.rpd) }) : t('ai.quota.noLimit')}</span>
                  </p>
                  {lim?.rpd ? (
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
                      <div className={cn('h-full rounded-full', pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-ink-muted' : 'bg-volt')} style={{ width: `${pct}%` }} />
                    </div>
                  ) : null}
                  {lim && (
                    <p className="tabular mt-2 text-[12px] text-ink-faint">
                      {t('ai.quota.lastMinute', {
                        req: l?.requests_last_minute ?? 0,
                        rpm: lim.rpm || '–',
                        tok: compact.format(l?.tokens_last_minute ?? 0),
                        tpm: lim.tpm ? compact.format(lim.tpm) : '–',
                      })}
                    </p>
                  )}
                </li>
              )
            })}
            <li>
              <button
                type="button"
                disabled={!app.data}
                onClick={() => setEditingGlobal(true)}
                aria-label={`${t('ai.quota.app')}: ${t('ai.global.edit')}`}
                className="flex w-full items-center justify-between gap-3 py-2 pl-4 pr-2 text-left transition-colors hover:bg-raised/50"
              >
                <span className="text-[13px] text-ink-muted">{t('ai.quota.app')}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="tabular text-[14px] font-semibold">
                    {app.data ? t('ai.quota.appValue', { used: nf.format(app.data.used), limit: nf.format(app.data.limit) }) : '…'}
                  </span>
                  <span className="flex size-10 items-center justify-center text-ink-faint" aria-hidden>
                    <Pencil className="size-4" />
                  </span>
                </span>
              </button>
            </li>
          </ul>
          <p className="mt-2 text-[11px] leading-snug text-ink-faint">{t('ai.quota.source')}</p>
        </section>

        <section aria-labelledby="trend-title">
          <h2 id="trend-title" className="display mb-3 text-[22px]">
            {t('ai.trend.title')}
          </h2>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Segmented
              options={PERIODS.map((p) => ({ value: p, label: t('ai.trend.days', { n: p }) }))}
              value={days}
              onChange={(v) => setDays(v as (typeof PERIODS)[number])}
            />
            <Segmented
              options={(['tokens', 'requests'] as const).map((m) => ({ value: m, label: t(`ai.trend.metric.${m}`) }))}
              value={metric}
              onChange={(v) => setMetric(v as Metric)}
            />
          </div>
          <TrendChart series={series} metric={metric} lang={lang} />
        </section>

        <section aria-labelledby="log-title">
          <h2 id="log-title" className="display mb-3 text-[22px]">
            {t('ai.log.title')}
          </h2>
          {usage.isLoading ? (
            <div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-surface" aria-busy="true" />
          ) : rows.length === 0 ? (
            <p className="hairline rounded-[var(--radius-card)] bg-surface px-4 py-6 text-[14px] text-ink-muted">{t('ai.log.empty')}</p>
          ) : (
            <Ledger rows={rows} lang={lang} />
          )}
        </section>
      </div>

      {editing && limits.data && <LimitsSheet initial={limits.data} onClose={() => setEditing(false)} />}
      {editingGlobal && app.data && <GlobalLimitSheet initial={app.data.limit} onClose={() => setEditingGlobal(false)} />}
    </PageShell>
  )
}

function ResetLine({ lang }: { lang: 'tr' | 'en' }) {
  const { t } = useTranslation('admin')
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  const next = nextMidnight(QUOTA_TZ, now)
  const locale = lang === 'tr' ? tr : enUS
  return (
    <p className="text-[13px] text-ink-muted">
      {t('ai.quota.reset', { time: format(next, 'HH:mm', { locale }), in: formatDistanceStrict(next, now, { locale }) })}
    </p>
  )
}

function Segmented<T extends string | number>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="hairline grid rounded-full bg-surface p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('h-10 truncate rounded-full px-1 text-[13px] font-medium transition-colors', value === o.value ? 'bg-raised text-ink' : 'text-ink-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function TrendChart({ series, metric, lang }: { series: ReturnType<typeof dailySeries>; metric: Metric; lang: 'tr' | 'en' }) {
  const { t } = useTranslation('admin')
  const locale = lang === 'tr' ? tr : enUS
  const nf = new Intl.NumberFormat(lang)
  const compact = compactFormatter(lang)
  const total = series.reduce((s, d) => s + d[metric], 0)
  const [animate] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  return (
    <figure aria-label={t('ai.trend.chartLabel')} className="hairline overflow-hidden rounded-[var(--radius-card)] bg-surface">
      <p className="tabular px-4 pt-4 text-[13px] text-ink-muted">{t('ai.trend.total', { value: `${nf.format(total)} ${t(`ai.trend.metric.${metric}`).toLocaleLowerCase(lang)}` })}</p>
      {total === 0 ? (
        <p className="px-4 py-14 text-center text-sm text-ink-muted">{t('ai.trend.empty')}</p>
      ) : (
        <div className="h-[200px] w-full pr-3 pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-line)" />
              <XAxis
                dataKey="day"
                tickFormatter={(d: string) => format(parseISO(d), 'd MMM', { locale })}
                tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
              />
              <YAxis tickFormatter={(v: number) => compact.format(v)} tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: 'var(--color-raised)' }}
                isAnimationActive={false}
                content={({ active, payload }) => {
                  const d = active ? (payload?.[0]?.payload as (typeof series)[number] | undefined) : undefined
                  if (!d) return null
                  const users = Object.entries(d.users).sort((a, b) => b[1] - a[1]).slice(0, 5)
                  return (
                    <div className="hairline rounded-[var(--radius-input)] bg-raised px-3 py-2 text-xs">
                      <p className="mb-1 font-semibold text-ink">{format(parseISO(d.day), 'd MMM yyyy', { locale })}</p>
                      <p className="tabular text-ink-muted">
                        {nf.format(d.requests)} {t('ai.quota.requests')} · {nf.format(d.tokens)} {t('ai.quota.tokens')}
                      </p>
                      {users.map(([who, tok]) => (
                        <p key={who} className="tabular text-ink-faint">
                          {who}: {nf.format(tok)}
                        </p>
                      ))}
                    </div>
                  )
                }}
              />
              <Bar dataKey={metric} fill="var(--color-volt)" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={animate} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  )
}

function Ledger({ rows, lang }: { rows: UsageRow[]; lang: 'tr' | 'en' }) {
  const { t } = useTranslation('admin')
  const locale = lang === 'tr' ? tr : enUS
  const nf = new Intl.NumberFormat(lang)
  const byDay = useMemo(() => {
    const m = new Map<string, UsageRow[]>()
    for (const r of rows) m.set(r.day_pt, [...(m.get(r.day_pt) ?? []), r])
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [rows])
  return (
    <div className="hairline overflow-hidden rounded-[var(--radius-card)] bg-surface">
      {byDay.map(([day, list], i) => {
        const tokens = list.reduce((s, r) => s + r.total_tokens, 0)
        return (
          <section key={day} className={i > 0 ? 'border-t border-line' : undefined} aria-label={day}>
            <div className="flex items-baseline justify-between gap-3 bg-raised/40 px-4 py-2.5">
              <h3 className="text-[13px] font-semibold capitalize">{format(parseISO(day), 'd MMMM, EEEE', { locale })}</h3>
              <span className="tabular text-[12px] text-ink-muted">
                {nf.format(tokens)} {t('ai.quota.tokens')}
              </span>
            </div>
            <ul className="divide-y divide-line">
              {list.map((r) => (
                <li key={`${r.user_id}-${r.action}-${r.model}`} className="flex items-start gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{r.user_id ? (r.display_name ?? r.username ?? '—') : t('ai.log.system')}</span>
                    <span className="block truncate text-[12px] text-ink-faint">
                      {t(`ai.log.actions.${r.action}`, { defaultValue: r.action })} · <span className="font-mono">{r.model}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="tabular block text-[13px] font-semibold">{t('ai.log.row', { requests: nf.format(r.requests), tokens: nf.format(r.total_tokens) })}</span>
                    <span className="tabular block text-[11px] text-ink-faint">
                      {t('ai.log.inOut', { in: nf.format(r.prompt_tokens), out: nf.format(r.output_tokens) })}
                      {r.failed > 0 && <span className="text-danger"> · {t('ai.log.failed', { count: r.failed })}</span>}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function LimitsSheet({ initial, onClose }: { initial: ModelLimits; onClose: () => void }) {
  const { t } = useTranslation('admin')
  const save = useSetAiModelLimits()
  const [draft, setDraft] = useState<ModelLimits>(initial)
  const set = (m: string, k: 'rpm' | 'tpm' | 'rpd', v: string) => {
    const n = Math.max(0, Math.round(Number(v.replace(/\D/g, '')) || 0))
    setDraft((d) => ({ ...d, [m]: { ...d[m], [k]: n } }))
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center lg:items-center" role="presentation">
      <button type="button" aria-label={t('ai.limits.cancel')} className="absolute inset-0 bg-bg/70 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={t('ai.limits.title')} className="rise-in hairline relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[var(--radius-sheet)] bg-surface px-5 pb-safe pt-6 lg:rounded-[var(--radius-sheet)] lg:pb-0">
        <h2 className="display text-[24px]">{t('ai.limits.title')}</h2>
        <p className="mt-1.5 text-[13px] leading-snug text-ink-muted">{t('ai.limits.hint')}</p>
        <div className="mt-5 space-y-5">
          {Object.entries(draft).map(([m, v]) => (
            <fieldset key={m}>
              <legend className="mb-2 font-mono text-[13px] text-ink-muted">{m}</legend>
              <div className="grid grid-cols-3 gap-2">
                {(['rpm', 'tpm', 'rpd'] as const).map((k) => (
                  <label key={k} className="block">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">{t(`ai.limits.${k}`)}</span>
                    <input
                      inputMode="numeric"
                      value={String(v[k])}
                      onChange={(e) => set(m, k, e.target.value)}
                      className="tabular hairline h-11 w-full rounded-[var(--radius-input)] bg-bg px-3 text-[16px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-volt"
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <ErrorNote error={save.error} className="mt-4" />
        <div className="mt-6 grid gap-2 pb-5">
          <Button size="lg" disabled={save.isPending} onClick={() => save.mutate(draft, { onSuccess: onClose })}>
            {save.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
            {t('ai.limits.save')}
          </Button>
          <Button size="lg" variant="ghost" onClick={onClose}>
            {t('ai.limits.cancel')}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** The app's own daily AI cap across all users (app_config.ai_global_daily_limit, 0..10000). */
function GlobalLimitSheet({ initial, onClose }: { initial: number; onClose: () => void }) {
  const { t } = useTranslation('admin')
  const save = useSetAdminConfig()
  const [draft, setDraft] = useState(String(initial))
  const parsed = parseLimit(draft, LIMITS.globalAi)
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center lg:items-center" role="presentation">
      <button type="button" aria-label={t('ai.limits.cancel')} className="absolute inset-0 bg-bg/70 backdrop-blur-sm" onClick={onClose} />
      <form
        role="dialog"
        aria-modal="true"
        aria-label={t('ai.global.title')}
        onSubmit={(e) => {
          e.preventDefault()
          if (parsed !== null) save.mutate({ key: 'ai_global_daily_limit', value: parsed }, { onSuccess: onClose })
        }}
        className="rise-in hairline relative w-full max-w-md rounded-t-[var(--radius-sheet)] bg-surface px-5 pb-safe pt-6 lg:rounded-[var(--radius-sheet)] lg:pb-0"
      >
        <h2 className="display text-[24px]">{t('ai.global.title')}</h2>
        <p className="mt-1.5 text-[13px] leading-snug text-ink-muted">{t('ai.global.hint')}</p>
        <label className="mt-5 block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">{t('ai.global.label')}</span>
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
            aria-invalid={parsed === null}
            className={cn(
              'tabular h-12 w-full rounded-[var(--radius-input)] bg-bg px-3 text-[20px] font-semibold text-ink outline-none ring-1 ring-inset focus-visible:ring-2 focus-visible:ring-volt',
              parsed === null ? 'ring-danger' : 'ring-line',
            )}
          />
        </label>
        {parsed === null && <p className="mt-1.5 text-[12px] text-danger">{t('ai.global.invalid', { max: LIMITS.globalAi })}</p>}
        <ErrorNote error={save.error} className="mt-4" />
        <div className="mt-6 grid gap-2 pb-5">
          <Button type="submit" size="lg" disabled={parsed === null || save.isPending}>
            {save.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
            {t('ai.limits.save')}
          </Button>
          <Button size="lg" variant="ghost" onClick={onClose}>
            {t('ai.limits.cancel')}
          </Button>
        </div>
      </form>
    </div>
  )
}

/** Short token counts. Turkish "B" would read as billion, so thousands are written as "bin". */
function compactFormatter(lang: 'tr' | 'en') {
  const one = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 })
  return {
    format: (n: number) => {
      if (n >= 1_000_000) return `${one.format(n / 1_000_000)} ${lang === 'tr' ? 'mn' : 'M'}`
      if (n >= 1_000) return `${one.format(n / 1_000)}${lang === 'tr' ? ' bin' : 'K'}`
      return one.format(n)
    },
  }
}
