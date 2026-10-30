import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { ChevronRight, Loader2, Search, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { Sheet } from '@/components/ui/Sheet'
import { useAuth } from '@/features/auth/AuthProvider'
import { avatarUrl } from '@/features/profile/api'
import { cn } from '@/lib/utils'
import { AdminFrame } from '../components/AdminFrame'
import { DEFAULT_USER_AI_LIMIT, LIMITS, parseLimit } from '../adminLogic'
import type { AdminUser } from '../api'
import { useAdminUsers, useSetUserAiLimit, useSetUserBlocked } from '../hooks'

/** Newest first, searchable by name, username or e-mail; tap a person for blocking and their AI limit. */
export function UsersPage() {
  const { t } = useTranslation('admin')
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const users = useAdminUsers(query)

  // search as you type, without a request per key press
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(input.trim().slice(0, LIMITS.query)), 300)
    return () => window.clearTimeout(id)
  }, [input])

  const rows = users.data ?? []
  const open = rows.find((r) => r.user_id === openId) ?? null

  return (
    <AdminFrame title={t('users.title')}>
      <form role="search" onSubmit={(e: FormEvent) => e.preventDefault()} className="relative mb-2">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
          aria-hidden
        />
        <input
          type="search"
          enterKeyHint="search"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={input}
          maxLength={LIMITS.query}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('users.search')}
          aria-label={t('users.search')}
          className="hairline h-12 w-full rounded-full bg-surface pl-10 pr-4 text-[16px] text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-volt"
        />
        {users.isFetching && (
          <Loader2
            className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-faint"
            aria-hidden
          />
        )}
      </form>
      <p className="tabular mb-4 px-1 text-[12px] text-ink-faint" aria-live="polite">
        {users.data
          ? query
            ? t('users.found', { count: rows.length })
            : t('users.newest', { count: rows.length })
          : ' '}
      </p>

      <ErrorNote error={users.error} className="mb-4" />

      {users.isLoading ? (
        <div
          className="hairline h-64 animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none"
          aria-busy="true"
        />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-ink-faint">
          <Users className="size-8" aria-hidden />
          <p className="text-sm">{t('users.empty')}</p>
        </div>
      ) : (
        <ul className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
          {rows.map((r) => (
            <li key={r.user_id}>
              <button
                type="button"
                onClick={() => setOpenId(r.user_id)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-raised/50"
              >
                <Avatar user={r} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={cn(
                        'truncate text-[15px] font-semibold leading-tight',
                        r.is_blocked && 'text-ink-muted line-through decoration-ink-faint',
                      )}
                    >
                      {r.display_name || r.username || r.email}
                    </span>
                    <Chips user={r} />
                  </span>
                  <span className="block truncate text-[12px] text-ink-faint">
                    {r.username ? `@${r.username} · ` : ''}
                    {r.email}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <UserSheet user={open} onClose={() => setOpenId(null)} />
    </AdminFrame>
  )
}

function Avatar({ user, size }: { user: AdminUser; size: number }) {
  const src = avatarUrl(user.avatar_path, user.created_at)
  const initial = (user.display_name || user.username || user.email || '?').charAt(0).toLocaleUpperCase()
  return src ? (
    <img
      src={src}
      alt=""
      className={cn('shrink-0 rounded-full object-cover', user.is_blocked && 'opacity-50 grayscale')}
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-raised text-[15px] font-semibold text-ink-muted"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {initial}
    </span>
  )
}

/** Only the states worth noticing: admin, blocked, not approved. */
function Chips({ user }: { user: AdminUser }) {
  const { t } = useTranslation('admin')
  const chip = 'shrink-0 rounded-full px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-[0.04em]'
  return (
    <>
      {user.role === 'admin' && (
        <span className={cn(chip, 'bg-volt/15 text-volt')}>{t('users.chip.admin')}</span>
      )}
      {user.is_blocked && (
        <span className={cn(chip, 'bg-danger/15 text-danger')}>{t('users.chip.blocked')}</span>
      )}
      {user.status !== 'approved' && (
        <span className={cn(chip, 'bg-raised text-ink-muted')}>
          {t(`status.${user.status}`, { defaultValue: user.status })}
        </span>
      )}
    </>
  )
}

function UserSheet({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const { t } = useTranslation('admin')
  return (
    <Sheet
      open={user !== null}
      label={user?.display_name || user?.email || ''}
      closeLabel={t('users.close')}
      onClose={onClose}
    >
      {/* keyed by user so the forms reset when another person opens */}
      {user && <UserDetail key={user.user_id} user={user} onClose={onClose} />}
    </Sheet>
  )
}

function UserDetail({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { t, i18n } = useTranslation('admin')
  const locale = i18n.resolvedLanguage === 'en' ? enUS : tr
  const { user: me } = useAuth()
  const isSelf = user.user_id === me?.id
  const isAdmin = user.role === 'admin'
  const block = useSetUserBlocked()
  const limit = useSetUserAiLimit()
  const current = user.ai_daily_limit ?? DEFAULT_USER_AI_LIMIT
  const [draft, setDraft] = useState(String(current))
  const [confirmBlock, setConfirmBlock] = useState(false)
  const parsed = parseLimit(draft, LIMITS.userAi)
  const lastActive = user.last_active_on
    ? formatDistanceToNowStrict(parseISO(user.last_active_on), { addSuffix: true, locale })
    : t('users.never')

  const saveLimit = (e: FormEvent) => {
    e.preventDefault()
    if (parsed !== null && parsed !== current) limit.mutate({ userId: user.user_id, limit: parsed })
  }

  return (
    <div className="pb-5">
      <div className="flex items-center gap-4">
        <Avatar user={user} size={60} />
        <div className="min-w-0">
          <h2 className="display truncate text-[24px]">{user.display_name || user.username || user.email}</h2>
          <p className="truncate text-[13px] text-ink-muted">
            {user.username ? `@${user.username}` : t('users.noProfile')}
          </p>
          <p className="truncate text-[12px] text-ink-faint">{user.email}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Chips user={user} />
      </div>

      <dl className="mt-5 grid grid-cols-2 border-y border-line">
        <div className="py-3 pr-3">
          <dt className="eyebrow">{t('users.joined')}</dt>
          <dd className="tabular mt-1 text-[14px]">
            {format(parseISO(user.created_at), 'd MMM yyyy', { locale })}
          </dd>
        </div>
        <div className="border-l border-line py-3 pl-4">
          <dt className="eyebrow">{t('users.lastActive')}</dt>
          <dd className="mt-1 text-[14px]">{lastActive}</dd>
        </div>
      </dl>

      <form onSubmit={saveLimit} className="mt-6">
        <label htmlFor="ai-limit" className="block text-[15px] font-semibold">
          {t('users.aiLimit')}
        </label>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-faint">
          {t('users.aiLimitHint', { n: DEFAULT_USER_AI_LIMIT, max: LIMITS.userAi })}
        </p>
        <div className="mt-3 flex gap-2">
          <input
            id="ai-limit"
            inputMode="numeric"
            pattern="[0-9]*"
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
            aria-invalid={parsed === null}
            className={cn(
              'tabular h-11 w-28 rounded-[var(--radius-input)] bg-bg px-3 text-[16px] text-ink outline-none ring-1 ring-inset focus-visible:ring-2 focus-visible:ring-volt',
              parsed === null ? 'ring-danger' : 'ring-line',
            )}
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={parsed === null || parsed === current || limit.isPending}
          >
            {limit.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('users.save')}
          </Button>
        </div>
        {parsed === null && (
          <p className="mt-1.5 text-[12px] text-danger">
            {t('users.aiLimitInvalid', { max: LIMITS.userAi })}
          </p>
        )}
        {limit.isSuccess && parsed === current && (
          <p className="mt-1.5 text-[12px] text-ink-muted">{t('users.saved')}</p>
        )}
        <ErrorNote error={limit.error} className="mt-3" />
      </form>

      <div className="mt-7 border-t border-line pt-5">
        <p className="text-[15px] font-semibold">{t('users.access')}</p>
        {isSelf || isAdmin ? (
          <p className="mt-1 text-[13px] leading-snug text-ink-faint">
            {isSelf ? t('users.selfNote') : t('users.adminNote')}
          </p>
        ) : user.is_blocked ? (
          <>
            <p className="mt-1 text-[13px] leading-snug text-ink-faint">{t('users.blockedNote')}</p>
            <Button
              variant="secondary"
              size="lg"
              className="mt-3 w-full"
              disabled={block.isPending}
              onClick={() => block.mutate({ userId: user.user_id, blocked: false })}
            >
              {block.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('users.unblock')}
            </Button>
          </>
        ) : confirmBlock ? (
          <>
            <p className="mt-1 text-[13px] leading-snug text-ink-muted">
              {t('users.blockConfirm', { name: user.display_name || user.email })}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="ghost" size="lg" onClick={() => setConfirmBlock(false)}>
                {t('users.cancel')}
              </Button>
              <Button
                variant="danger"
                size="lg"
                disabled={block.isPending}
                onClick={() =>
                  block.mutate(
                    { userId: user.user_id, blocked: true },
                    { onSuccess: () => setConfirmBlock(false) },
                  )
                }
              >
                {block.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t('users.block')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-[13px] leading-snug text-ink-faint">{t('users.blockHint')}</p>
            <Button
              variant="secondary"
              size="lg"
              className="mt-3 w-full text-danger"
              onClick={() => setConfirmBlock(true)}
            >
              {t('users.block')}
            </Button>
          </>
        )}
        <ErrorNote error={block.error} className="mt-3" />
      </div>

      <Button variant="ghost" size="lg" className="mt-4 w-full" onClick={onClose}>
        {t('users.close')}
      </Button>
    </div>
  )
}
