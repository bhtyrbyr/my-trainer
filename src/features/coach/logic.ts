/** Longest message the composer accepts (the database allows 4000; the model sees 1500 per message). */
export const MAX_INPUT = 1000
/** Conversation titles come from the first question. */
export const TITLE_MAX = 60

/** One-tap questions; each key has `coach:prompts.<key>.label` and `.text`. */
export const QUICK_PROMPTS = ['week', 'tomorrow', 'protein'] as const
export type QuickPrompt = (typeof QUICK_PROMPTS)[number] | 'weekly'
export const isQuickPrompt = (v: unknown): v is QuickPrompt =>
  v === 'weekly' || (typeof v === 'string' && (QUICK_PROMPTS as readonly string[]).includes(v))

/** Title from the first question: one line, cut on a word boundary. */
export function titleFrom(text: string, max = TITLE_MAX): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line.length <= max) return line
  const cut = line.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space >= max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, '')}…`
}

/** What the composer would send, or null when there is nothing (or too much). */
export function sendable(text: string): string | null {
  const t = text.trim()
  return t.length >= 1 && t.length <= MAX_INPUT ? t : null
}

export type Span = { text: string; bold: boolean }
export type Block = { kind: 'p'; spans: Span[] } | { kind: 'ul'; items: Span[][] } | { kind: 'ol'; items: Span[][] }

/** `**bold**` / `__bold__` inside a line; everything else stays literal text (never HTML). */
export function parseInline(line: string): Span[] {
  const spans: Span[] = []
  const re = /\*\*(.+?)\*\*|__(.+?)__/g
  let last = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) spans.push({ text: line.slice(last, m.index), bold: false })
    spans.push({ text: m[1] ?? m[2], bold: true })
    last = m.index + m[0].length
  }
  if (last < line.length) spans.push({ text: line.slice(last), bold: false })
  return spans.filter((s) => s.text.length > 0)
}

/**
 * Coach replies are plain text, but models still write lists, numbered steps and the odd **bold** or
 * "# heading". This turns them into paragraphs and lists for rendering as React text nodes.
 */
export function formatReply(text: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', spans: parseInline(para.join(' ')) })
    para = []
  }
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(line)
    const numbered = /^\d{1,2}[.)]\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      flush()
      const kind = bullet ? 'ul' : 'ol'
      const item = parseInline((bullet ?? numbered)![1])
      const prev = blocks[blocks.length - 1]
      if (prev && prev.kind === kind) prev.items.push(item)
      else blocks.push(kind === 'ul' ? { kind, items: [item] } : { kind, items: [item] })
      continue
    }
    // a markdown heading reads as a bold lead line
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ kind: 'p', spans: [{ text: heading[1].replace(/\*\*/g, ''), bold: true }] })
      continue
    }
    para.push(line)
  }
  flush()
  return blocks
}

export const COACH_ANSWERED = 'COACH_ANSWERED'

/**
 * Edge Function error -> thrown code. Shared AI gate codes get a COACH_ prefix where the food-estimate
 * wording would not fit (lib/errors.ts maps them); 409 means the newest message already has a reply.
 */
export function coachErrorCode(status: number, code: string): string {
  if (status === 409 && code === 'AI_BAD_INPUT') return COACH_ANSWERED
  if (/^AI_(QUOTA|APP_LIMIT|GOOGLE_DAILY|UNAVAILABLE|NOT_CONFIGURED|REGION)$/.test(code)) return `COACH_${code}`
  return code
}
