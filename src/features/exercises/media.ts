import type { CreditPart, Exercise, ExerciseAttribution } from './types'

/** Flipbook pace: one illustration frame per 700 ms. */
export const FRAME_MS = 700

export type ExerciseMedia =
  | { kind: 'frames'; paths: string[] }
  /** legacy ExerciseDB GIF, only while old rows still carry one */
  | { kind: 'gif'; path: string }
  | { kind: 'none' }

/** What to show for an exercise: its illustration frames, else a leftover GIF, else nothing (muscle map). */
export function exerciseMedia(ex: Pick<Exercise, 'media_frames' | 'gif_path'> | null | undefined): ExerciseMedia {
  const frames = (ex?.media_frames ?? []).filter(Boolean)
  if (frames.length) return { kind: 'frames', paths: frames }
  if (ex?.gif_path) return { kind: 'gif', path: ex.gif_path }
  return { kind: 'none' }
}

/** The single path a still thumbnail needs (first frame or the GIF). */
export function thumbPath(ex: Pick<Exercise, 'media_frames' | 'gif_path'> | null | undefined): string | null {
  const m = exerciseMedia(ex)
  return m.kind === 'frames' ? m.paths[0] : m.kind === 'gif' ? m.path : null
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
