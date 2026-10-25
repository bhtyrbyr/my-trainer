import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trophy } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { HeaderActions } from '@/components/layout/HeaderActions'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { avatarUrl } from '@/features/profile/api'
import { useAuth } from '@/features/auth/AuthProvider'
import { cn } from '@/lib/utils'
import type { LeaderboardRow } from '@/lib/database.types'
import { useLeaderboard } from '../hooks'
import type { LeaderboardPeriod } from '../api'

const PERIODS: LeaderboardPeriod[] = ['week', 'month', 'all']

/**
 * Point of view: a sports standings sheet. The leader gets one large "number one" card; everyone else
 * is a quiet ruled row with tabular numbers. Your own row is the only volt-tinted thing in the list.
 */
export function LeaderboardPage({ previewRows }: { previewRows?: LeaderboardRow[] }) {
  const { t } = useTranslation(['leaderboard', 'common'])
  const [period, setPeriod] = useState<LeaderboardPeriod>('week')
  const query = useLeaderboard(period)
  const { profile } = useAuth()
  const data = previewRows ?? query.data
  const isLoading = !previewRows && query.isLoading
  const error = previewRows ? null : query.error

  const rows = data ?? []
  const leader = rows.find((r) => r.rank === 1)
  const rest = rows.filter((r) => r !== leader)
  const meInList = rows.find((r) => r.is_me)

  return (
    <PageShell title={t('common:nav.leaderboard')} actions={<HeaderActions />}>
      <div role="tablist" aria-label={t('leaderboard:periodLabel')} className="hairline mb-5 grid grid-cols-3 rounded-full bg-surface p-1">
        {PERIODS.map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={period === p}
            onClick={() => setPeriod(p)}
            className={cn(
              'h-9 rounded-full text-sm font-medium transition-colors',
              period === p ? 'bg-raised text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {t(`leaderboard:period.${p}`)}
          </button>
        ))}
      </div>

      <ErrorNote error={error} className="mb-4" />

      {isLoading ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {leader && <LeaderCard row={leader} />}

          {rest.length > 0 && (
            <ol className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
              {rest.map((r) => (
                <Row key={r.user_id} row={r} />
              ))}
            </ol>
          )}

          {!meInList && profile && (
            <p className="px-1 text-center text-xs text-ink-faint">
              {profile.show_on_leaderboard ? t('leaderboard:notRankedYet') : t('leaderboard:hiddenSelf')}
            </p>
          )}

          <p className="px-1 text-center text-[11px] text-ink-faint">{t('leaderboard:footnote')}</p>
        </div>
      )}
    </PageShell>
  )
}

function LeaderCard({ row }: { row: LeaderboardRow }) {
  const { t } = useTranslation(['leaderboard', 'common'])
  const src = avatarUrl(row.avatar_path)
  return (
    <div
      className={cn(
        'hairline relative overflow-hidden rounded-[var(--radius-card)] bg-surface p-5',
        row.is_me && 'border-volt/50',
      )}
    >
      {/* soft volt glow behind the leader */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-16 size-48 rounded-full"
        style={{ background: 'radial-gradient(circle, oklch(91% 0.21 125 / 22%), transparent 70%)' }}
      />
      <div className="relative flex items-center gap-4">
        <div className="relative">
          {src ? (
            <img src={src} alt="" className="size-16 rounded-full object-cover ring-2 ring-volt" />
          ) : (
            <span className="block size-16 rounded-full bg-raised ring-2 ring-volt" />
          )}
          <span className="inner-glow absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full bg-volt text-volt-ink ring-[3px] ring-surface">
            <Trophy className="size-3.5" aria-hidden />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{t('leaderboard:leader')}</p>
          <p className="mt-1 truncate text-[19px] font-semibold leading-tight">
            {row.display_name}
            {row.is_me && <span className="ml-2 text-xs font-medium text-volt">{t('leaderboard:you')}</span>}
          </p>
          <p className="truncate text-xs text-ink-muted">
            @{row.username} · {t('common:level', { n: row.level })}
          </p>
        </div>
        <div className="text-right">
          <p className="display tabular text-[34px] leading-none text-ink">{row.points}</p>
          <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint">{t('leaderboard:pts')}</p>
        </div>
      </div>
      <p className="relative mt-4 text-xs text-ink-faint">{t('leaderboard:activeDays', { n: row.active_days })}</p>
    </div>
  )
}

function Row({ row }: { row: LeaderboardRow }) {
  const { t } = useTranslation(['leaderboard', 'common'])
  const src = avatarUrl(row.avatar_path)
  return (
    <li className={cn('flex items-center gap-3 px-4 py-3', row.is_me && 'bg-volt/[0.07]')}>
      <span className={cn('tabular w-6 text-center text-[15px] font-semibold', row.rank <= 3 ? 'text-ink' : 'text-ink-faint')}>
        {row.rank}
      </span>
      {src ? <img src={src} alt="" className="size-10 rounded-full object-cover" /> : <span className="size-10 rounded-full bg-raised" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium leading-tight">
          {row.display_name}
          {row.is_me && <span className="ml-2 text-xs font-medium text-volt">{t('leaderboard:you')}</span>}
        </p>
        <p className="truncate text-xs text-ink-faint">
          {t('common:level', { n: row.level })} · {t('leaderboard:activeDaysShort', { n: row.active_days })}
        </p>
      </div>
      <span className="tabular text-[17px] font-semibold">{row.points}</span>
    </li>
  )
}

function SkeletonList() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="hairline h-[132px] animate-pulse rounded-[var(--radius-card)] bg-surface" />
      <div className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <span className="h-4 w-6 rounded bg-raised" />
            <span className="size-10 rounded-full bg-raised" />
            <span className="h-4 flex-1 rounded bg-raised" />
          </div>
        ))}
      </div>
    </div>
  )
}

function EmptyState() {
  const { t } = useTranslation('leaderboard')
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-volt/10 text-volt">
        <Trophy className="size-6" aria-hidden />
      </span>
      <p className="text-[17px] font-semibold">{t('empty.title')}</p>
      <p className="max-w-[30ch] text-sm text-ink-muted">{t('empty.body')}</p>
    </div>
  )
}
