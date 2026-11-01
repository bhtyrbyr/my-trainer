import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Ban, Eye, ImageOff, Lock, LogOut, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { GroupedList, ListRow } from '@/components/ui/GroupedList'
import { useProfilePrivate } from '@/features/profile/hooks'
import { APP_NAME } from '@/config/brand'
import { cn } from '@/lib/utils'
import * as api from '../api'
import { socialEligibility } from '../logic'
import { useSocialAction } from '../hooks'

/**
 * The Community tab before joining. Point of view: an honest door, not a pitch. One headline, the five
 * facts that matter (private by default, who sees what, photo copies, blocking, leaving), the KVKK consent,
 * one action. Under 18 or without a birth year it stays a calm explanation.
 */
export function JoinIntro({ paused }: { paused?: boolean }) {
  const { t } = useTranslation(['social', 'legal'])
  const priv = useProfilePrivate()
  const [agreed, setAgreed] = useState(false)
  const enable = useSocialAction(() => api.enableSocial())
  const eligibility = priv.data ? socialEligibility(priv.data.birth_year) : null

  if (priv.isLoading)
    return (
      <div
        className="h-72 animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none"
        aria-busy="true"
      />
    )

  if (eligibility === 'underage' || eligibility === 'birth_year_required') {
    return (
      <section className="rise-in px-2 pt-6 text-center">
        <ShieldAlert className="mx-auto size-8 text-ink-faint" strokeWidth={1.5} aria-hidden />
        <h2 className="display mt-4 text-[26px]">
          {t(`social:intro.${eligibility === 'underage' ? 'underageTitle' : 'birthYearTitle'}`)}
        </h2>
        <p className="mx-auto mt-2 max-w-[34ch] text-[15px] leading-relaxed text-ink-muted">
          {t(`social:intro.${eligibility === 'underage' ? 'underageBody' : 'birthYearBody'}`)}
        </p>
        {eligibility === 'birth_year_required' && (
          <Link
            to="/me/edit"
            className="hairline mx-auto mt-6 flex h-11 max-w-xs items-center justify-center rounded-[var(--radius-button)] bg-raised px-5 text-[15px] font-semibold"
          >
            {t('social:intro.addBirthYear')}
          </Link>
        )}
        <RankingStill className="mx-auto mt-6 max-w-[34ch]" />
      </section>
    )
  }

  return (
    <section className="rise-in space-y-6" aria-labelledby="social-intro-title">
      <div className="pt-2">
        <h2 id="social-intro-title" className="display text-[32px]">
          {t(paused ? 'social:intro.pausedTitle' : 'social:intro.title')}
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
          {t('social:intro.lead', { app: APP_NAME })}
        </p>
      </div>

      <GroupedList title={t('social:intro.factsTitle')}>
        <ListRow
          icon={Lock}
          label={t('social:intro.facts.private')}
          hint={t('social:intro.facts.privateHint')}
        />
        <ListRow
          icon={Eye}
          label={t('social:intro.facts.visible')}
          hint={t('social:intro.facts.visibleHint')}
        />
        <ListRow
          icon={ImageOff}
          label={t('social:intro.facts.photos')}
          hint={t('social:intro.facts.photosHint')}
        />
        <ListRow icon={Ban} label={t('social:intro.facts.block')} hint={t('social:intro.facts.blockHint')} />
        <ListRow
          icon={LogOut}
          label={t('social:intro.facts.leave')}
          hint={t('social:intro.facts.leaveHint')}
        />
      </GroupedList>

      <label className="hairline flex cursor-pointer items-start gap-3 rounded-[var(--radius-card)] bg-surface p-4">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-[var(--color-volt)]"
        />
        <span className="text-[14px] leading-relaxed text-ink-muted">
          {t('legal:social.statement', { app: APP_NAME })}{' '}
          <Link to="/privacy" className="font-medium text-ink underline underline-offset-2">
            {t('legal:social.readNotice')}
          </Link>
        </span>
      </label>

      <ErrorNote error={enable.error} />
      <Button
        size="lg"
        className="w-full"
        disabled={!agreed || enable.isPending}
        onClick={() => enable.mutate(undefined)}
      >
        {enable.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
        {t('social:intro.join')}
      </Button>
      <RankingStill />
    </section>
  )
}

/** The ranking does not need Community; say so and link it (44 pt tall link, inline with the sentence). */
function RankingStill({ className }: { className?: string }) {
  const { t } = useTranslation('social')
  return (
    <p className={cn('text-center text-[13px] text-ink-faint', className)}>
      {t('intro.rankingStill')}{' '}
      <Link
        to="/social/ranking"
        className="inline-flex min-h-11 items-center font-medium text-ink underline underline-offset-2"
      >
        {t('intro.openRanking')}
      </Link>
    </p>
  )
}
