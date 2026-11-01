import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AtSign, X } from 'lucide-react'
import { useDebounced } from '@/lib/useDebounced'
import { cn } from '@/lib/utils'
import { Avatar } from '../../components/Avatar'
import { MAX_MENTIONS, activeMentionQuery, insertMention } from '../../mentions'
import { useMentionCandidates } from '../hooks'
import { BODY_MAX } from '../payload'
import type { AudienceChoice, MentionCandidate } from '../types'

type Props = {
  body: string
  onBody: (v: string) => void
  /** everyone picked so far (a person stays picked while their `@username` is written) */
  picked: MentionCandidate[]
  onPicked: (v: MentionCandidate[]) => void
  /** picked people still written in the text: the chips, and what is sent */
  tagged: MentionCandidate[]
  /** user ids among `tagged` that the current audience does not allow */
  blocked: ReadonlySet<string>
  target: AudienceChoice
  rows: number
}

/**
 * The composer's text with @mentions: typing `@` opens a flat suggestion list under the field (people the
 * author may tag for the CURRENT audience, from social_mention_candidates), picking writes `@username `.
 * Below the field the tagged people sit as removable chips; ones the audience no longer allows are struck
 * through with a one-line reason and are not sent.
 */
export function MentionField({ body, onBody, picked, onPicked, tagged, blocked, target, rows }: Props) {
  const { t } = useTranslation('share')
  const ref = useRef<HTMLTextAreaElement>(null)
  const listId = useId()
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [active, setActive] = useState(0)
  const pendingCaret = useRef<number | null>(null)

  const mq = focused ? activeMentionQuery(body, caret) : null
  const open = mq !== null && mq.start !== dismissed
  const settled = useDebounced(open ? mq.query : null, 200)
  const candidates = useMentionCandidates(settled, target)
  const full = tagged.length >= MAX_MENTIONS
  const options = settled === null ? [] : (candidates.data ?? []).filter((c) => !tagged.some((p) => p.user_id === c.user_id))
  const current = Math.min(active, Math.max(0, options.length - 1))
  const loading = open && (settled === null || candidates.isFetching) && options.length === 0
  const blockedNames = tagged.filter((p) => blocked.has(p.user_id)).map((p) => `@${p.username}`)

  useLayoutEffect(() => {
    const el = ref.current
    if (pendingCaret.current === null || !el) return
    el.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  }, [body])

  const sync = (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? el.value.length)

  const pick = (c: MentionCandidate) => {
    if (!mq || full) return
    const next = insertMention(body, mq, c.username, BODY_MAX)
    if (!next) return
    pendingCaret.current = next.caret
    setCaret(next.caret)
    onBody(next.text)
    setActive(0)
    if (!picked.some((p) => p.user_id === c.user_id))
      onPicked([...picked.filter((p) => p.username.toLowerCase() !== c.username.toLowerCase()), c])
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || !mq) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setDismissed(mq.start)
    } else if (options.length > 0 && !full) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((current + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
      } else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        pick(options[current]!)
      }
    }
  }

  const noneHint =
    target.audience === 'group' ? t('mentions.noneGroup') : target.audience === 'friends' ? t('mentions.noneFriends') : t('mentions.none')

  return (
    <div>
      <label className="block">
        <span className="sr-only">{t('composer.body')}</span>
        <textarea
          ref={ref}
          value={body}
          maxLength={BODY_MAX}
          rows={rows}
          onChange={(e) => {
            onBody(e.target.value)
            sync(e.target)
            setActive(0)
          }}
          onSelect={(e) => sync(e.currentTarget)}
          onFocus={(e) => {
            setFocused(true)
            sync(e.currentTarget)
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && options.length > 0 && !full ? `${listId}-${current}` : undefined}
          placeholder={t('composer.placeholder')}
          className="hairline block w-full resize-none rounded-[var(--radius-input)] bg-bg px-3.5 py-3 text-[16px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-volt"
        />
      </label>

      {open && (
        <div className="-mx-5 mt-2 border-y border-line">
          {full ? (
            <p className="px-5 py-3 text-[13px] text-ink-muted">{t('mentions.full', { count: MAX_MENTIONS })}</p>
          ) : loading ? (
            <div className="h-14 animate-pulse bg-raised/40 motion-reduce:animate-none" aria-busy="true" />
          ) : options.length === 0 ? (
            <p className="px-5 py-3 text-[13px] leading-snug text-ink-muted">{noneHint}</p>
          ) : (
            <ul id={listId} role="listbox" aria-label={t('mentions.suggestions')} className="divide-y divide-line">
              {options.map((c, i) => (
                <li
                  key={c.user_id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === current}
                  // keep the caret in the field: the list is picked with the pointer, not focused
                  onPointerDown={(e) => e.preventDefault()}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c)}
                  className={cn(
                    'flex min-h-14 cursor-pointer items-center gap-3 px-5 py-2 transition-colors',
                    i === current ? 'bg-raised/60' : 'hover:bg-raised/40',
                  )}
                >
                  <Avatar path={c.avatar_path} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium leading-5 text-ink">{c.display_name}</span>
                    <span className="block truncate text-[12px] leading-4 text-ink-faint">@{c.username}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-1 flex items-start justify-between gap-3">
        {!open && tagged.length === 0 ? (
          <span className="flex items-center gap-1 pt-px text-[11px] text-ink-faint">
            <AtSign className="size-3" aria-hidden />
            {t('mentions.hint')}
          </span>
        ) : (
          <span />
        )}
        <span className={cn('tabular shrink-0 text-[11px]', body.length > BODY_MAX - 50 ? 'text-ink' : 'text-ink-faint')}>
          {t('composer.count', { count: body.length, max: BODY_MAX })}
        </span>
      </div>

      {tagged.length > 0 && (
        <div className="mt-2">
          <p className="section-title px-1">
            {t('mentions.tagged')} <span className="tabular text-ink-faint">{t('mentions.of', { n: tagged.length, max: MAX_MENTIONS })}</span>
          </p>
          <ul className="mt-2 flex flex-wrap gap-2" aria-label={t('mentions.tagged')}>
            {tagged.map((p) => {
              const off = blocked.has(p.user_id)
              return (
                <li
                  key={p.user_id}
                  className={cn('hairline flex h-11 items-center rounded-full bg-bg pl-1.5', off && 'border-dashed')}
                >
                  <Avatar path={p.avatar_path} size={28} className={cn(off && 'opacity-40')} />
                  <span className={cn('ml-2 max-w-[11rem] truncate text-[14px] font-medium', off ? 'text-ink-faint line-through' : 'text-ink')}>
                    @{p.username}
                  </span>
                  <button
                    type="button"
                    onClick={() => onPicked(picked.filter((x) => x.user_id !== p.user_id))}
                    aria-label={t('mentions.remove', { name: p.username })}
                    className="flex size-11 items-center justify-center rounded-full text-ink-faint transition-colors hover:text-ink"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
          {blockedNames.length > 0 && (
            <p className="mt-2 px-1 text-[12px] leading-snug text-ink-muted" role="status">
              {t(`mentions.notAllowed.${target.audience}`, { names: blockedNames.join(', '), count: blockedNames.length })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
