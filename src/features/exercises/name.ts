import type { Exercise } from './types'

/** Display name in the UI language: Turkish name when present, else the English name with a capital first letter. */
export function exerciseName(ex: Pick<Exercise, 'name_en' | 'name_tr'>, lang: string | undefined): string {
  if (lang?.startsWith('tr') && ex.name_tr?.trim()) return ex.name_tr.trim()
  const en = ex.name_en.trim()
  return en.charAt(0).toLocaleUpperCase('en') + en.slice(1)
}

/** Instruction steps in the UI language, falling back to English. */
export function exerciseSteps(ex: Pick<Exercise, 'instructions_en' | 'instructions_tr'>, lang: string | undefined): string[] {
  if (lang?.startsWith('tr') && ex.instructions_tr?.length) return ex.instructions_tr
  return ex.instructions_en
}

/** PostgREST `or=` filters break on commas, parentheses and wildcards; keep search input to plain text. */
export function sanitizeSearch(q: string | undefined): string {
  return (q ?? '').replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
}
