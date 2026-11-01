import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { KeyRound, Loader2, Users } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import * as api from '../api'
import { parseInviteCode } from '../logic'
import { useSocialAction, useSocialMe } from '../hooks'
import { JoinIntro } from '../components/JoinIntro'
import { BackLink, ListSkeleton } from '../components/parts'

/**
 * /social/join/:code (invite link); /social/join without a code asks for one first ("Enter code"). Joining is an explicit tap, never a side effect of opening the link
 * (link previews and prefetchers must not join anyone). Not in Community yet: the join flow first.
 */
export function JoinByCodePage() {
  const { code = '' } = useParams()
  const { t } = useTranslation('social')
  const navigate = useNavigate()
  const me = useSocialMe()
  const join = useSocialAction(
    () => api.joinGroupByCode(code),
    (groupId) => navigate(`/social/g/${groupId}`, { replace: true }),
  )
  const title = code ? t('groups.joinTitle') : t('groups.codeEntryTitle')
  return (
    <PageShell title={title} leading={<BackLink title={title} />}>
      <div className="mx-auto max-w-xl pb-6">
        {me.isLoading ? (
          <ListSkeleton tall />
        ) : !me.data?.enabled ? (
          <>
            <p className="mb-5 text-[14px] text-ink-muted">{t('groups.joinNeedsSocial')}</p>
            <JoinIntro />
          </>
        ) : !code ? (
          <CodeEntry onCode={(c) => navigate(`/social/join/${encodeURIComponent(c)}`, { replace: true })} />
        ) : (
          <section className="rise-in pt-6 text-center">
            <Users className="mx-auto size-8 text-ink-faint" strokeWidth={1.5} aria-hidden />
            <h2 className="display mt-4 text-[26px]">{t('groups.joinTitle')}</h2>
            <p className="mx-auto mt-2 max-w-[32ch] text-[15px] leading-relaxed text-ink-muted">
              {t('groups.joinBody')}
            </p>
            <p className="display tabular mt-5 text-[26px] tracking-[0.08em]">{code.toUpperCase()}</p>
            <ErrorNote error={join.error} className="mt-4 text-left" />
            <Button
              size="lg"
              className="mt-6 w-full"
              disabled={join.isPending}
              onClick={() => join.mutate(undefined)}
            >
              {join.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
              {t('groups.joinAction')}
            </Button>
          </section>
        )}
      </div>
    </PageShell>
  )
}

/** Type the code or paste the whole invite link; the server upper-cases and checks it. */
function CodeEntry({ onCode }: { onCode: (code: string) => void }) {
  const { t } = useTranslation('social')
  const [value, setValue] = useState('')
  const code = parseInviteCode(value)
  return (
    <form
      className="rise-in pt-6 text-center"
      onSubmit={(e) => {
        e.preventDefault()
        if (code) onCode(code)
      }}
    >
      <KeyRound className="mx-auto size-8 text-ink-faint" strokeWidth={1.5} aria-hidden />
      <h2 className="display mt-4 text-[26px]">{t('groups.codeEntryTitle')}</h2>
      <p className="mx-auto mt-2 max-w-[32ch] text-[15px] leading-relaxed text-ink-muted">
        {t('groups.codeEntryBody')}
      </p>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={t('groups.code')}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        maxLength={200}
        className="display tabular hairline mt-6 h-14 w-full rounded-[var(--radius-input)] bg-surface px-3 text-center text-[22px] uppercase tracking-[0.08em] text-ink outline-none focus:border-volt"
      />
      <Button type="submit" size="lg" className="mt-4 w-full" disabled={!code}>
        {t('groups.codeContinue')}
      </Button>
    </form>
  )
}
