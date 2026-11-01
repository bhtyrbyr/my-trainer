import { z } from 'zod'

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/


export const onboardingSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(USERNAME_RE, 'username_invalid'),
  displayName: z.string().trim().min(1, 'display_name_required').max(40, 'display_name_too_long'),
  showOnLeaderboard: z.boolean(),
  birthYear: z
    .union([z.literal(''), z.coerce.number().int().min(1900).max(new Date().getFullYear())])
    .optional(),
  heightCm: z.union([z.literal(''), z.coerce.number().min(50).max(300)]).optional(),
  weightKg: z.union([z.literal(''), z.coerce.number().min(20).max(400)]).optional(),
  // Required (chips start empty, so '' is the "not chosen" state and is rejected on submit)
  sex: z
    .union([z.literal(''), z.enum(['male', 'female', 'other'])])
    .refine((v) => v !== '', { message: 'sex_required' }),
  goal: z
    .union([z.literal(''), z.enum(['lose_fat', 'build_muscle', 'maintain', 'performance'])])
    .refine((v) => v !== '', { message: 'goal_required' }),
})

export type OnboardingInput = z.input<typeof onboardingSchema>
export type OnboardingValues = z.output<typeof onboardingSchema>

/** Derive a username suggestion from a Google display name / email. */
export function suggestUsername(fullName: string | undefined, email: string | undefined): string {
  const base = (fullName || email?.split('@')[0] || 'user')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20)
  return base.length >= 3 ? base : `${base}_${Math.floor(100 + Math.random() * 900)}`.slice(0, 20)
}

/**
 * Profile edit (/me/edit): the onboarding rules for the shared fields, plus the target weight. Sex and
 * goal keep their "must be chosen" refinement, so an edit can never blank them out.
 */
export const profileEditSchema = onboardingSchema
  .pick({ username: true, displayName: true, birthYear: true, heightCm: true, sex: true, goal: true })
  .extend({ targetWeightKg: onboardingSchema.shape.weightKg })

export type ProfileEditInput = z.input<typeof profileEditSchema>
export type ProfileEditValues = z.output<typeof profileEditSchema>

/** Username changes are limited to one per 30 days (enforced by the profiles trigger, mirrored here). */
export const USERNAME_COOLDOWN_DAYS = 30

/** When the username may change again; null when it may change now (never changed, or cooldown over). */
export function nextUsernameChange(changedAt: string | null | undefined, now: Date = new Date()): Date | null {
  if (!changedAt) return null
  const next = new Date(new Date(changedAt).getTime() + USERNAME_COOLDOWN_DAYS * 86_400_000)
  return next.getTime() > now.getTime() ? next : null
}

/**
 * Same rule as the server's AI gate (ai_reserve, 20261105020000): a stored birth year after
 * (current year - 18) means the AI features are off. Unknown year = not a minor.
 */
export function isMinorBirthYear(birthYear: number | '' | null | undefined, now: Date = new Date()): boolean {
  if (birthYear === '' || birthYear == null || !Number.isFinite(birthYear)) return false
  return birthYear > now.getFullYear() - 18
}
