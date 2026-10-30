import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/Sheet'
import { useAuth } from '@/features/auth/AuthProvider'
import { badgeKeys, useMyBadges } from '../hooks'
import { celebrationQueue, type BadgeCode } from '../logic'
import { BadgeMedal } from './BadgeMedal'

const SEEN_KEY = 'mt.badges.seen.'

function readSeen(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSeen(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: the badge may be celebrated again next visit, nothing worse */
  }
}

/**
 * One sheet per newly earned badge, once per device. Badges are written by DB triggers right after
 * points move, so a change in the profile's points or streak refreshes the list.
 * `preview` shows the given codes without touching storage or the network.
 */
export function BadgeCelebration({ preview }: { preview?: BadgeCode[] }) {
  const { t } = useTranslation('badges')
  const qc = useQueryClient()
  const { user, profile } = useAuth()
  const mine = useMyBadges()
  const [queue, setQueue] = useState<BadgeCode[]>(preview ?? [])
  const key = SEEN_KEY + (user?.id ?? '')

  // something that can earn a badge happened (points or streak moved): look again
  const points = profile?.total_points
  const longest = profile?.longest_streak
  useEffect(() => {
    if (!preview && user) void qc.invalidateQueries({ queryKey: badgeKeys.mine })
  }, [points, longest, user, preview, qc])

  // mark as seen the moment they are queued, so each one is shown once even if the sheet is not closed
  const data = mine.data
  useEffect(() => {
    if (preview || !user || !data) return
    const { show, seen } = celebrationQueue(
      data.map((b) => b.badge_code),
      readSeen(key),
    )
    writeSeen(key, seen)
    if (show.length) setQueue((q) => [...q, ...show.filter((c) => !q.includes(c))])
  }, [data, key, user, preview])

  const current = queue[0]
  const close = () => setQueue((q) => q.slice(1))
  const remaining = queue.length - 1

  return (
    <Sheet open={Boolean(current)} label={t('celebrate.eyebrow')} closeLabel={t('close')} onClose={close}>
      {current && (
        <div className="relative flex flex-col items-center pb-5 pt-2 text-center">
          {/* one soft volt bloom behind the medal; the only decoration on the sheet */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[-24px] size-64 -translate-x-1/2 rounded-full"
            style={{
              background:
                'radial-gradient(circle, color-mix(in oklch, var(--color-volt) 26%, transparent), transparent 68%)',
            }}
          />
          <BadgeMedal code={current} earned size={104} className="relative" />
          <p className="relative mt-6 text-[11px] font-semibold uppercase tracking-[0.12em] text-volt">
            {t('celebrate.eyebrow')}
          </p>
          <h2 className="display relative mt-2 text-[34px]">{t(`items.${current}.name`)}</h2>
          <p className="relative mt-2 max-w-[30ch] text-[15px] leading-relaxed text-ink-muted">
            {t(`items.${current}.desc`)}
          </p>
          <Button size="lg" className="relative mt-8 w-full" onClick={close}>
            {remaining > 0 ? t('celebrate.next', { count: remaining }) : t('celebrate.done')}
          </Button>
        </div>
      )}
    </Sheet>
  )
}
