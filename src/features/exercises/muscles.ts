import type { Tables } from '@/lib/database.types'

export type Muscle = Pick<
  Tables<'muscles'>,
  'wger_id' | 'name_latin' | 'name_en' | 'name_tr' | 'is_front' | 'svg_main_path' | 'svg_secondary_path'
>

/** wger muscles plus the app-term -> wger id alias table (null = no counterpart on the diagram). */
export type MuscleCatalog = { muscles: Muscle[]; aliases: Record<string, number | null> }

export type MuscleMapData = {
  /** wger muscles painted at full strength (target muscles) */
  main: Muscle[]
  /** wger muscles painted lighter (secondary muscles not already a target) */
  secondary: Muscle[]
  /** muscle terms that have no wger overlay; shown as text */
  unmapped: string[]
}

/**
 * Maps an exercise's muscle terms onto wger overlays. A wger muscle used by a target is
 * never repeated as secondary; unmapped names keep their first-seen order and are de-duplicated.
 */
export function resolveMuscleMap(target: string[], secondary: string[], catalog: MuscleCatalog | undefined): MuscleMapData {
  const byId = new Map((catalog?.muscles ?? []).map((m) => [m.wger_id, m]))
  const mainIds = new Set<number>()
  const secondaryIds = new Set<number>()
  const unmapped: string[] = []
  const pick = (name: string, into: Set<number>) => {
    const id = catalog?.aliases[name.toLocaleLowerCase('en')]
    if (id != null && byId.has(id)) into.add(id)
    else if (!unmapped.includes(name)) unmapped.push(name)
  }
  target.forEach((n) => pick(n, mainIds))
  secondary.forEach((n) => pick(n, secondaryIds))
  for (const id of mainIds) secondaryIds.delete(id)
  const list = (ids: Set<number>) => [...ids].map((id) => byId.get(id)!).sort((a, b) => a.wger_id - b.wger_id)
  return { main: list(mainIds), secondary: list(secondaryIds), unmapped }
}

/** Storage paths the diagram needs: both silhouettes and every overlay. */
export const SILHOUETTE_FRONT = 'muscles/front.svg'
export const SILHOUETTE_BACK = 'muscles/back.svg'

export function muscleMapPaths(map: MuscleMapData): string[] {
  return [
    SILHOUETTE_FRONT,
    SILHOUETTE_BACK,
    ...map.main.map((m) => m.svg_main_path),
    ...map.secondary.map((m) => m.svg_secondary_path),
  ].filter((p): p is string => Boolean(p))
}
