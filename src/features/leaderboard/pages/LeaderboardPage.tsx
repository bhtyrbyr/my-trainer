import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trophy } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { avatarUrl } from '@/features/profile/api'
import { StreakAvatar } from '@/features/gamification/StreakAvatar'
import { useAuth } from '@/features/auth/AuthProvider'
import { PublicProfileSheet } from '@/features/badges'
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
  const [openId, setOpenId] = useState<string | null>(null)
  const open = rows.find((r) => r.user_id === openId) ?? null

  return (
    <PageShell title={t('common:nav.leaderboard')}>
      <div
        role="tablist"
        aria-label={t('leaderboard:periodLabel')}
        className="hairline mb-5 grid grid-cols-3 rounded-full bg-surface p-1"
      >
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
          {leader && <LeaderCard row={leader} onOpen={() => setOpenId(leader.user_id)} />}

          {rest.length > 0 && (
            <ol className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
              {rest.map((r) => (
                <Row key={r.user_id} row={r} onOpen={() => setOpenId(r.user_id)} />
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

      <PublicProfileSheet person={open} onClose={() => setOpenId(null)} />
    </PageShell>
  )
}

function LeaderCard({ row, onOpen }: { row: LeaderboardRow; onOpen: () => void }) {
  const { t } = useTranslation(['leaderboard', 'common'])
  const src = avatarUrl(row.avatar_path)
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'hairline relative block w-full overflow-hidden rounded-[var(--radius-card)] bg-surface p-5 text-left transition-colors hover:bg-raised/40',
        row.is_me && 'border-volt/50',
      )}
    >
      {/* soft volt glow behind the leader */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-16 size-48 rounded-full"
        style={{ background: 'radial-gradient(circle, oklch(91% 0.21 125 / 22%), transparent 70%)' }}
      />
      <span className="relative flex items-center gap-4">
        <span className="block relative">
          <StreakAvatar src={src} streak={row.streak} size={64} />
          {/* trophy sits top-left so the streak badge keeps the bottom-right corner */}
          <span className="inner-glow absolute -left-1.5 -top-1.5 flex size-7 items-center justify-center rounded-full bg-volt text-volt-ink ring-[3px] ring-surface">
            <Trophy className="size-3.5" aria-hidden />
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="block eyebrow">{t('leaderboard:leader')}</span>
            {row.is_me && <YouTag />}
          </span>
          <span className="block mt-1 truncate text-[19px] font-semibold leading-tight">{row.display_name}</span>
          <span className="block truncate text-xs text-ink-muted">
            @{row.username} · {t('common:level', { n: row.level })}
          </span>
        </span>
        <span className="block text-right">
          <span className="block display tabular text-[34px] leading-none text-ink">{row.points}</span>
          <span className="block mt-1 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint">
            {t('leaderboard:pts')}
          </span>
        </span>
      </span>
      <span className="block relative mt-4 text-xs text-ink-faint">
        {t('leaderboard:activeDays', { n: row.active_days })}
      </span>
    </button>
  )
}

function Row({ row, onOpen }: { row: LeaderboardRow; onOpen: () => void }) {
  const { t } = useTranslation(['leaderboard', 'common'])
  const src = avatarUrl(row.avatar_path)
  return (
    <li className={cn(row.is_me && 'bg-volt/[0.07]')}>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised/50"
      >
        <span
          className={cn(
            'tabular w-6 text-center text-[15px] font-semibold',
            row.rank <= 3 ? 'text-ink' : 'text-ink-faint',
          )}
        >
          {row.rank}
        </span>
        <StreakAvatar src={src} streak={row.streak} size={42} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2 text-[15px] font-medium leading-tight">
            <span className="block truncate">{row.display_name}</span>
            {row.is_me && <YouTag />}
          </span>
          <span className="block truncate text-xs text-ink-faint">
            {t('common:level', { n: row.level })} · {t('leaderboard:activeDaysShort', { n: row.active_days })}
          </span>
        </span>
        <span className="block tabular text-[17px] font-semibold">{row.points}</span>
      </button>
    </li>
  )
}

/** Never truncated: the name shrinks first, the tag always stays visible. */
function YouTag() {
  const { t } = useTranslation('leaderboard')
  return (
    <span className="shrink-0 rounded-full bg-volt/15 px-1.5 py-px text-[11px] font-semibold text-volt">
      {t('you')}
    </span>
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
