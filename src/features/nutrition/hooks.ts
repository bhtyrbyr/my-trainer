import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import * as api from './api'
import { useIsNutritionPreview } from './previewContext'
import type { CatalogFood, DraftItem, EstimateResult, Food, MealEntry, MealEntryInsert, ProductHit } from './types'

export const nutritionKeys = {
  all: ['nutrition'] as const,
  day: (day: string) => ['nutrition', 'day', day] as const,
  foods: ['nutrition', 'foods'] as const,
  catalog: (q: string) => ['nutrition', 'catalog', q.toLocaleLowerCase('tr')] as const,
  products: (q: string) => ['nutrition', 'products', q.toLocaleLowerCase('tr')] as const,
}

export function useMeals(day: string) {
  const preview = useIsNutritionPreview()
  return useQuery({ queryKey: nutritionKeys.day(day), queryFn: () => api.listMeals(day), enabled: !preview })
}

export function useFoods() {
  const preview = useIsNutritionPreview()
  return useQuery({ queryKey: nutritionKeys.foods, queryFn: api.listFoods, enabled: !preview, staleTime: 5 * 60_000 })
}

/** Meal and protein-goal points are written by triggers: refresh profile and leaderboard afterwards. */
function useAfterMealChange() {
  const qc = useQueryClient()
  const { refreshProfile } = useAuth()
  return () => Promise.all([qc.invalidateQueries({ queryKey: nutritionKeys.all }), qc.invalidateQueries({ queryKey: ['leaderboard'] }), refreshProfile()])
}

type AddInput = { day: string; slot: string; drafts: DraftItem[]; saveToFoods: boolean; usedFoods: Food[] }

export function useAddMeals() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const preview = useIsNutritionPreview()
  const after = useAfterMealChange()
  return useMutation({
    mutationFn: async ({ day, slot, drafts, saveToFoods, usedFoods }: AddInput) => {
      const rows: MealEntryInsert[] = drafts.map((d) => ({
        eaten_on: day,
        meal_slot: slot,
        name: d.portion ? `${d.name} · ${d.portion}`.slice(0, 120) : d.name.slice(0, 120),
        kcal: Math.round(d.kcal),
        protein_g: d.protein_g,
        carb_g: d.carb_g,
        fat_g: d.fat_g,
        source: d.source,
        food_id: d.food_id,
      }))
      if (preview) {
        const now = new Date().toISOString()
        qc.setQueryData<MealEntry[]>(nutritionKeys.day(day), (prev = []) => [
          ...prev,
          ...rows.map((r, i) => ({ ...r, id: `p-${Date.now()}-${i}`, user_id: 'preview', servings: 1, created_at: now, updated_at: now }) as MealEntry),
        ])
        return
      }
      await api.addMeals(user!.id, rows)
      if (saveToFoods) await api.saveFoods(user!.id, drafts.filter((d) => d.source !== 'food'))
      await Promise.all(usedFoods.map((f) => api.touchFood(f)))
    },
    onSuccess: () => {
      if (!preview) void after()
    },
  })
}

export function useUpdateMeal() {
  const qc = useQueryClient()
  const preview = useIsNutritionPreview()
  const after = useAfterMealChange()
  return useMutation({
    mutationFn: async ({ id, day, patch }: { id: string; day: string; patch: Partial<MealEntryInsert> }) => {
      if (!preview) return api.updateMeal(id, patch)
      qc.setQueryData<MealEntry[]>(nutritionKeys.day(day), (prev = []) => prev.map((m) => (m.id === id ? ({ ...m, ...patch } as MealEntry) : m)))
    },
    onSuccess: () => {
      if (!preview) void after()
    },
  })
}

export function useDeleteMeal() {
  const qc = useQueryClient()
  const preview = useIsNutritionPreview()
  const after = useAfterMealChange()
  return useMutation({
    mutationFn: async ({ id, day }: { id: string; day: string }) => {
      if (!preview) return api.deleteMeal(id)
      qc.setQueryData<MealEntry[]>(nutritionKeys.day(day), (prev = []) => prev.filter((m) => m.id !== id))
    },
    onSuccess: () => {
      if (!preview) void after()
    },
  })
}

export function useDeleteFood() {
  const qc = useQueryClient()
  const preview = useIsNutritionPreview()
  return useMutation({
    mutationFn: async (id: string) => {
      if (!preview) return api.deleteFood(id)
      qc.setQueryData<Food[]>(nutritionKeys.foods, (prev = []) => prev.filter((f) => f.id !== id))
    },
    onSuccess: () => {
      if (!preview) void qc.invalidateQueries({ queryKey: nutritionKeys.foods })
    },
  })
}

const SAMPLE: EstimateResult = {
  provider: 'preview',
  model: 'preview',
  remaining: 37,
  items: [
    { name: 'Haşlanmış yumurta', portion: '2 adet', kcal: 155, protein_g: 12.6, carb_g: 1.1, fat_g: 10.6 },
    { name: 'Beyaz peynir', portion: '1 dilim (30 g)', kcal: 93, protein_g: 5.1, carb_g: 0.6, fat_g: 7.8 },
    { name: 'Tam buğday ekmeği', portion: '2 dilim', kcal: 160, protein_g: 7.2, carb_g: 28.4, fat_g: 2.2 },
  ],
}

export function useEstimateFood() {
  const { i18n } = useTranslation()
  const preview = useIsNutritionPreview()
  return useMutation({
    mutationFn: async ({ text, photo }: { text: string; photo: Blob | null }) => {
      if (preview) return new Promise<EstimateResult>((r) => setTimeout(() => r(SAMPLE), 700))
      const image = photo ? await api.prepareFoodPhoto(photo) : undefined
      return api.estimateFood({ text: text.trim() || undefined, image, locale: i18n.resolvedLanguage === 'en' ? 'en' : 'tr' })
    },
  })
}

const PREVIEW_CATALOG: CatalogFood[] = [
  { id: 'tr:mercimek-corbasi', source: 'curated', name_en: 'Red lentil soup', name_tr: 'Mercimek çorbası', name_tr_machine: false, category: 'Çorbalar', kcal_100g: 56, protein_100g: 3.3, carb_100g: 8.6, fat_100g: 1.2, portion_g: 250, portion_tr: '1 kase', portion_en: '1 bowl', search_text: '', updated_at: '' },
  { id: 'usda:173757', source: 'usda_sr', name_en: 'Lentils, mature seeds, cooked, boiled, without salt', name_tr: 'Mercimek, haşlanmış', name_tr_machine: true, category: 'Legumes and Legume Products', kcal_100g: 116, protein_100g: 9, carb_100g: 20.1, fat_100g: 0.4, portion_g: 198, portion_tr: '1 su bardağı', portion_en: '1 cup', search_text: '', updated_at: '' },
]
const PREVIEW_PRODUCTS: ProductHit[] = [
  { code: '8690000000001', name: 'Kırmızı mercimek', brand: 'Örnek Marka', kcal_100g: 333, protein_100g: 24, carb_100g: 52, fat_100g: 1.5, serving_g: 50, serving_label: '50 g' },
]

/** Catalog search while typing (cheap, own database). */
export function useCatalogSearch(q: string) {
  const preview = useIsNutritionPreview()
  return useQuery({
    queryKey: nutritionKeys.catalog(q),
    queryFn: () => (preview ? Promise.resolve(PREVIEW_CATALOG.filter((c) => (c.name_tr ?? c.name_en).toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr').slice(0, 4)))) : api.searchCatalog(q)),
    enabled: q.length >= 2,
    staleTime: 10 * 60_000,
    placeholderData: (prev) => prev,
  })
}

/** Packaged-product search, only on an explicit tap (Open Food Facts allows ~10 searches a minute). */
export function useProductSearch(q: string | null) {
  const preview = useIsNutritionPreview()
  return useQuery({
    queryKey: nutritionKeys.products(q ?? ''),
    queryFn: () => (preview ? new Promise<ProductHit[]>((r) => setTimeout(() => r(PREVIEW_PRODUCTS), 500)) : api.searchProducts(q!)),
    enabled: q !== null && q.length >= 2,
    staleTime: 60 * 60_000,
    retry: false,
  })
}
