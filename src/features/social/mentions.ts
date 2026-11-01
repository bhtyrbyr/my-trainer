/**
 * @mentions in post text, and the one tokenizer that renders a post body (hashtags + mentions).
 *
 * A mention token is `@` + 3..20 characters of [A-Za-z0-9_] (the username rule, compared case-insensitively
 * like the citext column), not preceded by a word character, `@`, `.` or `&` (so e-mail addresses and
 * `a@b` are not mentions) and not followed by another word character (a longer run is not a mention).
 * Only tokens whose username is in the post's `mentions` list become links: the list is what the server
 * validated and stored, the text is just how the author wrote it.
 */
import { splitHashtags } from './hashtags'

/** At most this many people per post (server: TOO_MANY_MENTIONS). */
export const MAX_MENTIONS = 10

export type MentionRef = { user_id: string; username: string; display_name: string }

export type PostTextSegment =
  | { type: 'text'; text: string }
  | { type: 'tag'; text: string; tag: string }
  /** `text` is the token as written (with `@`). */
  | { type: 'mention'; text: string; userId: string; username: string }

const WORD = '0-9A-Za-zÇĞİÖŞÜçğıöşü_'
// no lookbehind (older iOS Safari): the character before `@` is checked by hand
const MENTION_RE = new RegExp(`@([A-Za-z0-9_]{3,20})(?![${WORD}])`, 'g')
const BEFORE_BLOCK = new RegExp(`[${WORD}@.&]`)

/** Every syntactically valid mention token in `text`: start offset, length and lower-cased username. */
function mentionTokens(text: string): { start: number; end: number; username: string }[] {
  const out: { start: number; end: number; username: string }[] = []
  for (const m of text.matchAll(MENTION_RE)) {
    const start = m.index ?? 0
    if (start > 0 && BEFORE_BLOCK.test(text[start - 1]!)) continue
    out.push({ start, end: start + m[0].length, username: (m[1] ?? '').toLowerCase() })
  }
  return out
}

/** Lower-cased usernames of every `@username` token written in `text` (whether or not it was picked). */
export function writtenMentions(text: string): Set<string> {
  return new Set(mentionTokens(text).map((m) => m.username))
}

/**
 * Splits a post body into plain text, hashtag and mention segments, in order; joining every `text` gives
 * the input back. Hashtags follow splitHashtags exactly; mentions link only when listed in `mentions`.
 */
export function splitPostText(text: string, mentions: readonly MentionRef[] = []): PostTextSegment[] {
  const byName = new Map(mentions.map((m) => [m.username.toLowerCase(), m]))
  const tokens = byName.size ? mentionTokens(text).filter((m) => byName.has(m.username)) : []
  const out: PostTextSegment[] = []
  const pushText = (s: string) => {
    if (!s) return
    const last = out.at(-1)
    if (last?.type === 'text') last.text += s
    else out.push({ type: 'text', text: s })
  }
  let offset = 0
  let ti = 0
  for (const seg of splitHashtags(text)) {
    const segEnd = offset + seg.text.length
    if (seg.type === 'tag') {
      out.push(seg)
    } else {
      // tags and mentions never overlap ('@' is not a tag character and '#' is not a username character)
      let pos = offset
      while (ti < tokens.length && tokens[ti]!.start < segEnd) {
        const tok = tokens[ti++]!
        if (tok.start < pos) continue
        pushText(text.slice(pos, tok.start))
        const ref = byName.get(tok.username)!
        out.push({ type: 'mention', text: text.slice(tok.start, tok.end), userId: ref.user_id, username: ref.username })
        pos = tok.end
      }
      pushText(text.slice(pos, segEnd))
    }
    offset = segEnd
  }
  return out
}

/** Reads the `mentions` jsonb of a post row defensively. */
export function readMentions(v: unknown): MentionRef[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((m) => {
    const r = m as Partial<MentionRef> | null
    return r && typeof r.user_id === 'string' && typeof r.username === 'string'
      ? [{ user_id: r.user_id, username: r.username, display_name: typeof r.display_name === 'string' ? r.display_name : r.username }]
      : []
  })
}

// --- composer --------------------------------------------------------------------------------------

/** What the user is typing right now: `@` + up to 30 name characters ending at the caret. */
export type MentionQuery = { start: number; end: number; query: string }

const QUERY_TAIL = new RegExp(`(^|[^${WORD}@.&])@([${WORD}]{0,30})$`)
const QUERY_REST = new RegExp(`^[${WORD}]*`)

/**
 * The mention being typed at `caret`, or null. `query` excludes the `@` (may be empty: just typed `@`);
 * `end` also covers name characters right after the caret, so picking replaces the whole word.
 */
export function activeMentionQuery(text: string, caret: number): MentionQuery | null {
  const m = QUERY_TAIL.exec(text.slice(0, caret))
  if (!m) return null
  const query = m[2] ?? ''
  const start = caret - query.length - 1
  const rest = QUERY_REST.exec(text.slice(caret))?.[0] ?? ''
  return { start, end: caret + rest.length, query }
}

/**
 * Replaces the typed `@query` with `@username ` (no second space when one already follows). Returns the
 * new text and caret, or null when the result would be longer than `max`.
 */
export function insertMention(text: string, q: MentionQuery, username: string, max = Infinity): { text: string; caret: number } | null {
  const after = text.slice(q.end)
  const token = `@${username}${/^\s/.test(after) ? '' : ' '}`
  const next = text.slice(0, q.start) + token + after
  if (next.length > max) return null
  const caret = q.start + token.length + (/^\s/.test(after) ? 1 : 0)
  return { text: next, caret }
}

/** The picked people whose `@username` is still written in the text (the rest are dropped on publish). */
export function keepWritten<T extends { username: string }>(picked: readonly T[], text: string): T[] {
  const written = writtenMentions(text)
  return picked.filter((p) => written.has(p.username.toLowerCase()))
}
