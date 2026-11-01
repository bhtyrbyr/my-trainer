import type { BodySlug } from './types'

/**
 * Catalog muscle terms (src/features/exercises/vocab.ts, scripts/muscle-aliases.json, ExerciseDB-style
 * short forms) -> body-highlighter parts. A term may light several parts; terms missing here (cardio,
 * ankles, rotator cuff, ...) have no counterpart on the figure and are listed as text only.
 * The figures have no separate abductor shape: the outer hip sits in `gluteal`.
 */
const TERM_SLUGS: Record<string, readonly BodySlug[]> = {
  // chest and trunk
  pectorals: ['chest'],
  chest: ['chest'],
  'serratus anterior': ['obliques'],
  abdominals: ['abs'],
  abs: ['abs'],
  core: ['abs', 'obliques'],
  obliques: ['obliques'],
  // arms
  biceps: ['biceps'],
  brachialis: ['biceps'],
  triceps: ['triceps'],
  forearms: ['forearm'],
  'wrist extensors': ['forearm'],
  'wrist flexors': ['forearm'],
  'grip muscles': ['forearm'],
  // shoulders, neck
  deltoids: ['deltoids'],
  delts: ['deltoids'],
  shoulders: ['deltoids'],
  'rear deltoids': ['deltoids'],
  trapezius: ['trapezius'],
  traps: ['trapezius'],
  'levator scapulae': ['trapezius'],
  sternocleidomastoid: ['neck'],
  neck: ['neck'],
  // back
  'upper back': ['upper-back'],
  'latissimus dorsi': ['upper-back'],
  lats: ['upper-back'],
  rhomboids: ['upper-back'],
  back: ['upper-back', 'lower-back'],
  'erector spinae': ['lower-back'],
  'lower back': ['lower-back'],
  spine: ['lower-back'],
  // hips and legs
  glutes: ['gluteal'],
  abductors: ['gluteal'],
  adductors: ['adductors'],
  'hip flexors': ['quadriceps'],
  quadriceps: ['quadriceps'],
  quads: ['quadriceps'],
  hamstrings: ['hamstring'],
  calves: ['calves'],
  soleus: ['calves'],
  'tibialis anterior': ['tibialis'],
  shins: ['tibialis'],
}

/** Body parts for one muscle term (case-insensitive); empty when the figure has no counterpart. */
export function slugsForTerm(term: string): readonly BodySlug[] {
  return TERM_SLUGS[term.trim().toLocaleLowerCase('en')] ?? []
}

export type BodyHighlight = {
  /** parts painted in full volt */
  target: BodySlug[]
  /** parts painted in the faint volt (never repeats a target part) */
  secondary: BodySlug[]
  /** terms (as given, first-seen order, de-duplicated) without a part on the figure */
  unmapped: string[]
}

/** Maps an exercise's target and secondary muscle terms onto the figure. */
export function resolveBodyHighlight(target: string[], secondary: string[]): BodyHighlight {
  const t = new Set<BodySlug>()
  const s = new Set<BodySlug>()
  const unmapped: string[] = []
  const pick = (term: string, into: Set<BodySlug>) => {
    const slugs = slugsForTerm(term)
    if (slugs.length) slugs.forEach((slug) => into.add(slug))
    else if (!unmapped.includes(term)) unmapped.push(term)
  }
  target.forEach((term) => pick(term, t))
  secondary.forEach((term) => pick(term, s))
  for (const slug of t) s.delete(slug)
  return { target: [...t], secondary: [...s], unmapped }
}
