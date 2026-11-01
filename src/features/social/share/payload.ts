// Pure builders for post payloads. They mirror private.social_payload_valid on the server (keys, limits)
// so a share never fails on validation, and they only copy what the user chose to share (no notes).
import { AUDIENCES, type Audience, type BestSet, type MealPayload, type MediaRef, type Post, type PostItem, type PostKind, type ProgramExercise, type ProgramPayload, type WorkoutPayload } from './types'

export const BODY_MAX = 1000
export const REASON_MAX = 300
export const NAME_MAX = 120
// limits mirror the server's payload checks (20261160000000_social_hardening.sql)
export const MAX_WORKOUT_EXERCISES = 30
export const MAX_DAYS = 7
export const MAX_DAY_EXERCISES = 30
export const TEMPLATE_NAME_MAX = 80

const round1 = (n: number) => Math.round(n * 10) / 10
const nonNeg = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)
const clip = (s: string, max = NAME_MAX) => s.trim().slice(0, max)
const int = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(nonNeg(n))))

type SetIn = { weight_kg: number | null; reps: number | null; is_warmup?: boolean | null }

/** Best working set: highest weight (ties: more reps); bodyweight sets compare by reps. */
export function bestSet(sets: readonly SetIn[]): BestSet | undefined {
  let best: BestSet | undefined
  for (const s of sets) {
    if (s.is_warmup || !s.reps || s.reps <= 0) continue
    const cand: BestSet = {
      weight_kg: s.weight_kg != null && s.weight_kg > 0 ? Math.min(s.weight_kg, 2000) : null,
      reps: Math.min(s.reps, 1000),
    }
    const cw = cand.weight_kg ?? 0
    const bw = best?.weight_kg ?? 0
    if (!best || cw > bw || (cw === bw && cand.reps > best.reps)) best = cand
  }
  return best
}

/** Local calendar date of an ISO timestamp, yyyy-MM-dd. */
export function localDate(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export type WorkoutInput = {
  startedAt: string
  durationSec: number | null
  volumeKg: number | null
  totalSets: number | null
  exercises: { name: string; sets: readonly SetIn[] }[]
}

/** Finished session -> workout payload: date, duration, volume, sets, exercises with their best set. */
export function workoutPayload(w: WorkoutInput): WorkoutPayload {
  const exercises = w.exercises
    .filter((e) => e.sets.some((s) => !s.is_warmup && (s.reps ?? 0) > 0))
    .slice(0, MAX_WORKOUT_EXERCISES)
    .map((e) => {
      const best = bestSet(e.sets)
      const name = clip(e.name) || '?'
      return best ? { name, best } : { name }
    })
  return {
    date: localDate(w.startedAt),
    duration_sec: Math.min(Math.round(nonNeg(w.durationSec)), 604800),
    volume_kg: Math.min(round1(nonNeg(w.volumeKg)), 1_000_000),
    sets: Math.min(Math.round(nonNeg(w.totalSets)), 10000),
    exercises,
  }
}

type ExIn = { name: string; exercise_id?: string | null; sets: number; reps_low: number; reps_high: number }

function programExercise(e: ExIn): ProgramExercise {
  const low = int(e.reps_low, 1, 500)
  const high = Math.max(low, int(e.reps_high, 1, 500))
  const out: ProgramExercise = { name: clip(e.name) || '?', sets: int(e.sets, 1, 50), reps_low: low, reps_high: high }
  if (e.exercise_id) out.exercise_id = e.exercise_id.slice(0, 64)
  return out
}

/** Program payload from named days. Empty days are dropped; limits as on the server. */
export function programPayload(name: string, days: { name: string; exercises: ExIn[] }[]): ProgramPayload {
  const programName = clip(name) || '?'
  return {
    name: programName,
    days: days
      .filter((d) => d.exercises.length > 0)
      .slice(0, MAX_DAYS)
      .map((d) => ({ name: clip(d.name) || programName, exercises: d.exercises.slice(0, MAX_DAY_EXERCISES).map(programExercise) })),
  }
}

type TemplateIn = {
  name: string
  exercises: { exercise_id: string; target_sets: number; target_reps_low: number; target_reps_high: number }[]
}

/** A single workout template is a one-day program. Custom exercises travel by name only. */
export function templateProgramPayload(template: TemplateIn, meta: (exerciseId: string) => { name: string; isCustom: boolean } | undefined): ProgramPayload {
  return programPayload(template.name, [
    {
      name: template.name,
      exercises: template.exercises.map((e) => {
        const m = meta(e.exercise_id)
        return {
          name: m?.name ?? '?',
          exercise_id: m && !m.isCustom ? e.exercise_id : null,
          sets: e.target_sets,
          reps_low: e.target_reps_low,
          reps_high: e.target_reps_high,
        }
      }),
    },
  ])
}

/** Meal macros; the name is optional and dropped when empty. */
export function mealPayload(m: { name?: string | null; kcal: number; protein_g: number; carb_g: number; fat_g: number }): MealPayload {
  const out: MealPayload = {
    kcal: Math.round(nonNeg(m.kcal)),
    protein_g: round1(nonNeg(m.protein_g)),
    carb_g: round1(nonNeg(m.carb_g)),
    fat_g: round1(nonNeg(m.fat_g)),
  }
  const name = m.name ? clip(m.name) : ''
  if (name) out.name = name
  return out
}

/** Stored payloads are never trusted: null when the shape is not what this kind expects. */
export function readWorkout(p: unknown): WorkoutPayload | null {
  const o = p as WorkoutPayload | null
  return o && typeof o.date === 'string' && Array.isArray(o.exercises) ? o : null
}
export function readProgram(p: unknown): ProgramPayload | null {
  const o = p as ProgramPayload | null
  return o && typeof o.name === 'string' && Array.isArray(o.days) && o.days.every((d) => d && Array.isArray(d.exercises)) ? o : null
}
export function readMeal(p: unknown): MealPayload | null {
  const o = p as MealPayload | null
  return o && typeof o.kcal === 'number' ? o : null
}

/** "<program> - <day>" within the 80-character template name limit; a one-day program keeps its name. */
export function templateName(program: string, day: string, single: boolean): string {
  const p = program.trim()
  const d = day.trim()
  const name = single || !d || p === d ? p : `${p} - ${d}`
  return name.slice(0, TEMPLATE_NAME_MAX).trim() || '?'
}

export type TemplateCopyItem = {
  id: string
  exercise_id: string
  target_sets: number
  target_reps_low: number
  target_reps_high: number
  rest_seconds: number
}
export type TemplateCopy = { templates: { name: string; weekdays: number[]; exercises: TemplateCopyItem[] }[]; skipped: string[] }

/**
 * "Copy to my templates": one template per day; only exercises whose id is a known catalog exercise are
 * kept, the rest are reported by name. Days left empty are not created.
 */
export function programToTemplates(program: ProgramPayload, catalogIds: ReadonlySet<string>, newId: () => string, restSec = 90): TemplateCopy {
  const skipped: string[] = []
  const single = program.days.length === 1
  const templates: TemplateCopy['templates'] = []
  for (const day of program.days) {
    const exercises: TemplateCopyItem[] = []
    for (const e of day.exercises) {
      const id = e.exercise_id != null ? String(e.exercise_id) : ''
      if (id && catalogIds.has(id)) {
        const low = int(e.reps_low, 1, 500)
        exercises.push({
          id: newId(),
          exercise_id: id,
          target_sets: int(e.sets, 1, 50),
          target_reps_low: low,
          target_reps_high: Math.max(low, int(e.reps_high, 1, 500)),
          rest_seconds: restSec,
        })
      } else if (!skipped.includes(e.name)) skipped.push(e.name)
    }
    if (exercises.length) templates.push({ name: templateName(program.name, day.name, single), weekdays: [], exercises })
  }
  return { templates, skipped }
}

/** All exercise ids a program references (checked against the catalog before copying). */
export function programExerciseIds(program: ProgramPayload): string[] {
  const ids = program.days.flatMap((d) => d.exercises.map((e) => (e.exercise_id != null ? String(e.exercise_id) : '')))
  return [...new Set(ids.filter(Boolean))]
}

/** Relative time bucket for the post header; i18n renders it. */
export function relativeTime(created: Date, now: Date): { unit: 'now' | 'm' | 'h' | 'd' | 'date'; n: number } {
  const sec = Math.max(0, (now.getTime() - created.getTime()) / 1000)
  if (sec < 60) return { unit: 'now', n: 0 }
  if (sec < 3600) return { unit: 'm', n: Math.floor(sec / 60) }
  if (sec < 86400) return { unit: 'h', n: Math.floor(sec / 3600) }
  if (sec < 7 * 86400) return { unit: 'd', n: Math.floor(sec / 86400) }
  return { unit: 'date', n: 0 }
}

const KINDS: readonly PostKind[] = ['text', 'workout', 'program', 'meal', 'photo', 'progress', 'compare']

/** Resolves the nullable composite columns of social_post_item; unknown kinds render as text. */
export function toPost(item: PostItem): Post {
  const media = Array.isArray(item.media) ? (item.media as unknown as MediaRef[]).filter((m) => m && typeof m.path === 'string') : []
  return {
    id: item.id ?? '',
    author_id: item.author_id ?? '',
    author_username: item.author_username ?? '',
    author_display_name: item.author_display_name ?? item.author_username ?? '',
    author_avatar_path: item.author_avatar_path ?? null,
    kind: KINDS.includes(item.kind as PostKind) ? (item.kind as PostKind) : 'text',
    body: item.body ?? null,
    payload: item.payload,
    audience: AUDIENCES.includes(item.audience as Audience) ? (item.audience as Audience) : 'followers',
    group_id: item.group_id ?? null,
    group_name: item.group_name ?? null,
    like_count: Math.max(0, item.like_count ?? 0),
    liked_by_me: item.liked_by_me === true,
    media: media.sort((a, b) => a.position - b.position),
    created_at: item.created_at ?? new Date(0).toISOString(),
  }
}
