import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, Users } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import * as api from '../api'
import { useSocialAction, useSocialMe } from '../hooks'
import { JoinIntro } from '../components/JoinIntro'
import { BackLink, ListSkeleton } from '../components/parts'

/**
 * /social/join/:code (invite link). Joining is an explicit tap, never a side effect of opening the link
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
  return (
    <PageShell title={t('groups.joinTitle')} leading={<BackLink title={t('groups.joinTitle')} />}>
      <div className="mx-auto max-w-xl pb-6">
        {me.isLoading ? (
          <ListSkeleton tall />
        ) : !me.data?.enabled ? (
          <>
            <p className="mb-5 text-[14px] text-ink-muted">{t('groups.joinNeedsSocial')}</p>
            <JoinIntro />
          </>
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
