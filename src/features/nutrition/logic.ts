import { MEAL_SLOTS, type DraftItem, type MealEntry, type MealSlot, type Totals } from './types'

const r1 = (n: number) => Math.round(n * 10) / 10

export function totalsOf(rows: Pick<MealEntry, 'kcal' | 'protein_g' | 'carb_g' | 'fat_g'>[]): Totals {
  return rows.reduce<Totals>(
    (t, r) => ({
      kcal: t.kcal + Number(r.kcal),
      protein_g: r1(t.protein_g + Number(r.protein_g)),
      carb_g: r1(t.carb_g + Number(r.carb_g)),
      fat_g: r1(t.fat_g + Number(r.fat_g)),
    }),
    { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 },
  )
}

export function bySlot(rows: MealEntry[]): Record<MealSlot, MealEntry[]> {
  const out = Object.fromEntries(MEAL_SLOTS.map((s) => [s, [] as MealEntry[]])) as Record<MealSlot, MealEntry[]>
  for (const r of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const slot = (MEAL_SLOTS as readonly string[]).includes(r.meal_slot) ? (r.meal_slot as MealSlot) : 'snack'
    out[slot].push(r)
  }
  return out
}

/** Meal slot that fits the local time: 04-11 breakfast, 11-16 lunch, 16-22 dinner, otherwise a snack. */
export function slotForTime(d: Date): MealSlot {
  const h = d.getHours()
  if (h >= 4 && h < 11) return 'breakfast'
  if (h >= 11 && h < 16) return 'lunch'
  if (h >= 16 && h < 22) return 'dinner'
  return 'snack'
}

/** Scale a draft by a number of servings (rounded like the database columns). */
export function scaleDraft(d: DraftItem, servings: number): DraftItem {
  return {
    ...d,
    kcal: Math.round(d.kcal * servings),
    protein_g: r1(d.protein_g * servings),
    carb_g: r1(d.carb_g * servings),
    fat_g: r1(d.fat_g * servings),
  }
}

/** Remaining kcal against a goal (negative when over); null without a goal. */
export function remaining(goal: number | null | undefined, eaten: number): number | null {
  return goal ? goal - eaten : null
}

/** Parse a user-typed decimal ("12,5" or "12.5"); empty -> 0; invalid -> null. */
export function parseAmount(s: string): number | null {
  const t = s.trim().replace(',', '.')
  if (t === '') return 0
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
