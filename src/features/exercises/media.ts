import type { CreditPart, Exercise, ExerciseAttribution } from './types'

/** Flipbook pace: one illustration frame per 700 ms. */
export const FRAME_MS = 700

/**
 * ExerciseDB animations are hot-linked from their CDN: never copied to our storage, never cached by our
 * service worker (vite.config.ts NetworkOnly rule), requested without a referrer.
 */
export const EXERCISEDB_MEDIA_ORIGIN = 'https://static.exercisedb.dev'

/** Same shape as the DB check (exercises_exercisedb_id_chk), so no other path can be built from a row. */
const EXERCISEDB_ID = /^[A-Za-z0-9]{4,16}$/

export function exerciseDbGifUrl(id: string | null | undefined): string | null {
  const v = id?.trim()
  return v && EXERCISEDB_ID.test(v) ? `${EXERCISEDB_MEDIA_ORIGIN}/media/${v}.gif` : null
}

export type ExerciseMedia =
  | { kind: 'gif'; url: string }
  | { kind: 'frames'; paths: string[] }
  | { kind: 'none' }

type MediaSource = Partial<Pick<Exercise, 'media_frames' | 'exercisedb_id'>>

/**
 * What to show for an exercise, in order: the ExerciseDB GIF, else its illustration frames, else
 * nothing (the body map). `gifFailed` skips a GIF that did not load.
 */
export function exerciseMedia(ex: MediaSource | null | undefined, opts: { gifFailed?: boolean } = {}): ExerciseMedia {
  const gif = opts.gifFailed ? null : exerciseDbGifUrl(ex?.exercisedb_id)
  if (gif) return { kind: 'gif', url: gif }
  const frames = (ex?.media_frames ?? []).filter(Boolean)
  if (frames.length) return { kind: 'frames', paths: frames }
  return { kind: 'none' }
}

/** The single storage path a still thumbnail needs when there is no GIF (the first frame). */
export function thumbPath(ex: MediaSource | null | undefined): string | null {
  const m = exerciseMedia(ex, { gifFailed: true })
  return m.kind === 'frames' ? m.paths[0] : null
}

export type Credit =
  | ({ role: 'text' | 'media' } & { author: string | null; license: string | null; url: string | null })
  | { role: 'translation' }

const clean = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null)

function part(role: 'text' | 'media', p: CreditPart | null | undefined): Credit | null {
  if (!p || typeof p !== 'object') return null
  const author = clean(p.author)
  const license = clean(p.license)
  if (!author && !license) return null
  const url = clean(p.url)
  return { role, author, license, url: url && /^https?:\/\//i.test(url) ? url : null }
}

/** True when the sync marked the Turkish text as machine translated ("translated to Turkish (machine)"). */
export function isMachineTranslated(attr: ExerciseAttribution | null | undefined): boolean {
  return (attr?.changes ?? []).some((c) => typeof c === 'string' && /turkish/i.test(c) && /machine/i.test(c))
}

/**
 * The credit line under an exercise: text source, illustration source and, when the reader sees the
 * Turkish text, a machine-translation note. Only http(s) links survive; empty parts are dropped.
 */
export function exerciseCredits(attr: ExerciseAttribution | null | undefined, lang: string | undefined): Credit[] {
  if (!attr || typeof attr !== 'object') return []
  const out = [part('text', attr.text), part('media', attr.media)].filter((c): c is Credit => c !== null)
  if (lang?.startsWith('tr') && isMachineTranslated(attr)) out.push({ role: 'translation' })
  return out
}
