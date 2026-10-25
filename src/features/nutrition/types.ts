import type { Tables, TablesInsert } from '@/lib/database.types'

export type MealEntry = Tables<'meal_entries'>
export type Food = Tables<'foods'>
export type CatalogFood = Tables<'food_catalog'>
export type MealEntryInsert = Omit<TablesInsert<'meal_entries'>, 'user_id' | 'id' | 'created_at' | 'updated_at'>

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type MealSlot = (typeof MEAL_SLOTS)[number]

export type EntrySource = 'manual' | 'food' | 'ai_text' | 'ai_photo' | 'catalog' | 'off'

/** One line in the "to add" list, whatever produced it (AI, manual, saved food). Values are per item, not per serving. */
export type DraftItem = {
  key: string
  name: string
  portion: string
  kcal: number
  protein_g: number
  carb_g: number
  fat_g: number
  source: EntrySource
  food_id: string | null
}

export type EstimateItem = { name: string; portion: string; kcal: number; protein_g: number; carb_g: number; fat_g: number }
export type EstimateResult = { items: EstimateItem[]; provider: string; model: string; remaining: number | null }

export type Totals = { kcal: number; protein_g: number; carb_g: number; fat_g: number }

/** Packaged product from Open Food Facts (values per 100 g), via the food-search Edge Function. */
export type ProductHit = {
  code: string
  name: string
  brand: string | null
  kcal_100g: number
  protein_100g: number
  carb_100g: number
  fat_100g: number
  serving_g: number | null
  serving_label: string | null
}
