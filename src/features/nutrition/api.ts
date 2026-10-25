import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { downscaleJpeg } from '@/lib/image'
import type { DraftItem, EstimateResult, Food, MealEntry, MealEntryInsert } from './types'

/** The caller's entries for one local day (RLS scopes the rows; no client-side user filter). */
export async function listMeals(day: string): Promise<MealEntry[]> {
  const { data, error } = await supabase.from('meal_entries').select('*').eq('eaten_on', day).order('created_at')
  if (error) throw error
  return data ?? []
}

export async function addMeals(userId: string, rows: MealEntryInsert[]): Promise<void> {
  if (!rows.length) return
  const { error } = await supabase.from('meal_entries').insert(rows.map((r) => ({ ...r, user_id: userId })))
  if (error) throw error
}

export async function updateMeal(id: string, patch: Partial<MealEntryInsert>): Promise<void> {
  const { error } = await supabase.from('meal_entries').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteMeal(id: string): Promise<void> {
  const { error } = await supabase.from('meal_entries').delete().eq('id', id)
  if (error) throw error
}

export async function listFoods(): Promise<Food[]> {
  const { data, error } = await supabase
    .from('foods')
    .select('*')
    .order('last_used_at', { ascending: false, nullsFirst: false })
    .order('name')
    .limit(300)
  if (error) throw error
  return data ?? []
}

/** Save drafts to "frequently eaten"; a name already on the list is left as it is. */
export async function saveFoods(userId: string, drafts: DraftItem[]): Promise<void> {
  for (const d of drafts) {
    const { error } = await supabase.from('foods').insert({
      user_id: userId,
      name: d.name.trim().slice(0, 80),
      serving_desc: d.portion.trim().slice(0, 60) || null,
      kcal: Math.round(d.kcal),
      protein_g: d.protein_g,
      carb_g: d.carb_g,
      fat_g: d.fat_g,
      use_count: 1,
      last_used_at: new Date().toISOString(),
    })
    if (error && error.code !== '23505') throw error
  }
}

/** Bump a saved food to the top of the list after it is used. */
export async function touchFood(food: Pick<Food, 'id' | 'use_count'>): Promise<void> {
  const { error } = await supabase.from('foods').update({ use_count: food.use_count + 1, last_used_at: new Date().toISOString() }).eq('id', food.id)
  if (error) throw error
}

export async function deleteFood(id: string): Promise<void> {
  const { error } = await supabase.from('foods').delete().eq('id', id)
  if (error) throw error
}

/** Re-encode a photo to a <= 1024px JPEG (drops EXIF/location) and return its base64 body. */
export async function prepareFoodPhoto(file: Blob): Promise<{ mimeType: 'image/jpeg'; data: string }> {
  const jpeg = await downscaleJpeg(file, 1024, 0.8)
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('READ_FAILED'))
    reader.readAsDataURL(jpeg)
  })
  return { mimeType: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) }
}

/**
 * Ask the ai-coach Edge Function for an estimate. The browser never talks to Gemini/OpenRouter;
 * the function holds the keys and counts the request against the daily limit.
 */
export async function estimateFood(input: { text?: string; image?: { mimeType: string; data: string }; locale: 'tr' | 'en' }): Promise<EstimateResult> {
  const { data, error } = await supabase.functions.invoke('ai-coach', { body: { action: 'food-estimate', ...input } })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = await (error.context as Response).json().catch(() => null)
      throw new Error(typeof body?.error === 'string' ? body.error : 'AI_UNAVAILABLE')
    }
    throw error
  }
  const items = Array.isArray(data?.items) ? data.items : []
  return { items, provider: String(data?.provider ?? ''), model: String(data?.model ?? ''), remaining: typeof data?.remaining === 'number' ? data.remaining : null }
}
