/**
 * Hashtags in post text. The database extracts tags with the identical rule (keep them in sync):
 * `#` + 2..30 characters of [0-9A-Za-zÇĞİÖŞÜçğıöşü_], not preceded by one of those characters or `&`
 * (so `a#b` and HTML entities like `&#123;` are not tags), not followed by another tag character (a longer
 * run is not a tag), and not all digits (`#2024` is not a tag, `#5x5` is). The database keeps only the
 * first MAX_TAGS distinct normalised tags of a post, so later new tags stay plain text.
 */
export const MAX_TAGS = 10

const CHARS = '0-9A-Za-zÇĞİÖŞÜçğıöşü_'
// no lookbehind (older iOS Safari): the preceding character is captured in group 1 instead
const TAG_RE = new RegExp(`(^|[^${CHARS}&])#([${CHARS}]{2,30})(?![${CHARS}])`, 'g')
const DIGITS_RE = /^[0-9]+$/

export type HashtagSegment =
  | { type: 'text'; text: string }
  /** `text` is the tag as written (with `#`), `tag` the normalised form used in links and the database. */
  | { type: 'tag'; text: string; tag: string }

/**
 * Turkish-aware lower case: `İ` -> `i` and `I` -> `ı` first (plain toLowerCase would turn `İ` into
 * `i` + combining dot and `I` into `i`), then toLowerCase(). A leading `#` is dropped.
 */
export function normalizeTag(s: string): string {
  return s.replace(/^#/, '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase()
}

/**
 * Splits text into plain and hashtag segments, in order; joining every `text` gives the input back. Only
 * the first MAX_TAGS distinct tags become tag segments (repeats of those stay tags).
 */
export function splitHashtags(text: string): HashtagSegment[] {
  const out: HashtagSegment[] = []
  let plain = ''
  let last = 0
  const seen = new Set<string>()
  for (const m of text.matchAll(TAG_RE)) {
    const [, before = '', body = ''] = m
    if (DIGITS_RE.test(body)) continue
    const tag = normalizeTag(body)
    if (!seen.has(tag) && seen.size >= MAX_TAGS) continue
    seen.add(tag)
    const start = (m.index ?? 0) + before.length
    plain += text.slice(last, start)
    if (plain) out.push({ type: 'text', text: plain })
    plain = ''
    out.push({ type: 'tag', text: `#${body}`, tag })
    last = start + 1 + body.length
  }
  plain += text.slice(last)
  if (plain) out.push({ type: 'text', text: plain })
  return out
}
