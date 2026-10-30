import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { format, parseISO } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { Loader2, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { cn } from '@/lib/utils'
import { AdminFrame, Switch } from '../components/AdminFrame'
import { LIMITS, normalizeEmail, type AccessMode } from '../adminLogic'
import {
  useAddAllowedEmail,
  useAdminConfig,
  useAllowedEmails,
  useRemoveAllowedEmail,
  useSetAdminConfig,
} from '../hooks'

const MODES: AccessMode[] = ['open', 'invite']

/**
 * Access. Point of view: a door with two settings and a guest list. The mode is a two-way choice
 * written out in plain words; approval is one switch; the invite list is a ruled ledger with the add
 * form on top. The list stays editable in open mode, with a note that it is not enforced then.
 */
export function AccessPage() {
  const { t } = useTranslation('admin')
  const config = useAdminConfig()
  const setConfig = useSetAdminConfig()
  const mode = config.data?.access_mode
  const approval = config.data?.require_approval

  return (
    <AdminFrame title={t('access.title')}>
      <div className="space-y-10">
        <ErrorNote error={config.error ?? setConfig.error} />

        <section aria-labelledby="mode-title" className="space-y-3">
          <h2 id="mode-title" className="display text-[22px]">
            {t('access.mode.title')}
          </h2>
          <div
            role="radiogroup"
            aria-labelledby="mode-title"
            className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface"
          >
            {MODES.map((m) => {
              const active = mode === m
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={!config.data}
                  onClick={() => !active && setConfig.mutate({ key: 'access_mode', value: m })}
                  className="flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-raised/50 disabled:opacity-60"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                      active ? 'border-volt' : 'border-line-strong',
                    )}
                  >
                    {active && <span className="size-2.5 rounded-full bg-volt" />}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        'block text-[15px] font-semibold',
                        active ? 'text-ink' : 'text-ink-muted',
                      )}
                    >
                      {t(`access.mode.${m}`)}
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-ink-faint">
                      {t(`access.mode.${m}Hint`)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="hairline flex items-center gap-3 rounded-[var(--radius-card)] bg-surface py-2 pl-4 pr-2">
            <span className="min-w-0 flex-1 py-2">
              <span className="block text-[15px] font-semibold">{t('access.approval.title')}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-ink-faint">
                {approval === false ? t('access.approval.off') : t('access.approval.on')}
              </span>
            </span>
            <Switch
              checked={approval ?? true}
              disabled={!config.data}
              label={t('access.approval.title')}
              onChange={(v) => setConfig.mutate({ key: 'require_approval', value: v })}
            />
          </div>
        </section>

        <InviteList enforced={mode === 'invite'} />
      </div>
    </AdminFrame>
  )
}

function InviteList({ enforced }: { enforced: boolean }) {
  const { t, i18n } = useTranslation('admin')
  const locale = i18n.resolvedLanguage === 'en' ? enUS : tr
  const list = useAllowedEmails()
  const add = useAddAllowedEmail()
  const remove = useRemoveAllowedEmail()
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const normalized = normalizeEmail(email)
    if (!normalized) {
      setInvalid(true)
      return
    }
    add.mutate(
      { email: normalized, note: note.trim() || null },
      {
        onSuccess: () => {
          setEmail('')
          setNote('')
        },
      },
    )
  }

  const rows = list.data ?? []
  return (
    <section aria-labelledby="invite-title" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="invite-title" className="display text-[22px]">
          {t('access.invite.title')}
        </h2>
        {list.data && (
          <span className="tabular text-[12px] text-ink-faint">
            {t('access.invite.count', { count: rows.length })}
          </span>
        )}
      </div>
      <p className="text-[13px] leading-snug text-ink-muted">
        {enforced ? t('access.invite.enforced') : t('access.invite.notEnforced')}
      </p>

      <form
        onSubmit={submit}
        className="hairline space-y-2 rounded-[var(--radius-card)] bg-surface p-3"
        noValidate
      >
        <label className="block">
          <span className="sr-only">{t('access.invite.email')}</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            maxLength={254}
            onChange={(e) => {
              setEmail(e.target.value)
              setInvalid(false)
            }}
            placeholder={t('access.invite.email')}
            aria-invalid={invalid}
            aria-describedby={invalid ? 'invite-invalid' : undefined}
            className={cn(
              'h-11 w-full rounded-[var(--radius-input)] bg-bg px-3 text-[16px] text-ink outline-none ring-1 ring-inset placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-volt',
              invalid ? 'ring-danger' : 'ring-line',
            )}
          />
        </label>
        {invalid && (
          <p id="invite-invalid" className="px-1 text-[12px] text-danger">
            {t('access.invite.invalid')}
          </p>
        )}
        <div className="flex gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t('access.invite.note')}</span>
            <input
              value={note}
              maxLength={LIMITS.note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('access.invite.note')}
              className="h-11 w-full rounded-[var(--radius-input)] bg-bg px-3 text-[16px] text-ink outline-none ring-1 ring-inset ring-line placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-volt"
            />
          </label>
          <Button type="submit" disabled={add.isPending || !email.trim()} className="shrink-0 px-5">
            {add.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('access.invite.add')}
          </Button>
        </div>
      </form>
      <ErrorNote error={add.error ?? remove.error ?? list.error} />

      {list.isLoading ? (
        <div
          className="hairline h-32 animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none"
          aria-busy="true"
        />
      ) : rows.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-faint">
          {t('access.invite.empty')}
        </p>
      ) : (
        <ul className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">
          {rows.map((r) => {
            const busy = remove.isPending && remove.variables === r.email
            const meta = [
              r.note,
              r.added_by_username && `@${r.added_by_username}`,
              format(parseISO(r.created_at), 'd MMM yyyy', { locale }),
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <li key={r.email} className="flex items-center gap-2 py-2 pl-4 pr-2">
                <div className="min-w-0 flex-1 py-1">
                  <p className="truncate text-[15px] font-medium">{r.email}</p>
                  <p className="truncate text-[12px] text-ink-faint">{meta}</p>
                </div>
                {confirming === r.email ? (
                  <div className="flex shrink-0 items-center">
                    <Button
                      variant="danger"
                      size="sm"
                      className="h-11"
                      disabled={busy}
                      onClick={() => remove.mutate(r.email, { onSettled: () => setConfirming(null) })}
                    >
                      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                      {t('access.invite.remove')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('access.invite.keep')}
                      onClick={() => setConfirming(null)}
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('access.invite.removeLabel', { email: r.email })}
                    onClick={() => setConfirming(r.email)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
