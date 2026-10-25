// Pure helpers for scripts/sync-foods.mjs (unit-tested in src/lib/foodCatalogLib.test.ts).

/** USDA categories that are not useful for a personal food log in Turkey. */
export const EXCLUDED_CATEGORIES = new Set([
  'Baby Foods',
  'American Indian/Alaska Native Foods',
  'Restaurant Foods',
  'Fast Foods',
])

/** Minimal RFC 4180 line parser: quoted fields, doubled quotes, commas inside quotes. */
export function parseCsvLine(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/** First available energy value (kcal) in priority order: Energy, Atwater specific, Atwater general. */
export function pickEnergy(nutrients, ids) {
  for (const id of ids) {
    const v = nutrients[String(id)]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

/** SR Legacy marks brand names in capitals ("KELLOGG'S", "McDONALD'S"); skip those rows. */
export function isBrandedDescription(description) {
  return /\b[A-Z][A-Z'&.]{2,}\b.*\b[A-Z][A-Z'&.]{2,}\b|\b[A-Z]{2,}'S\b|\bMc[A-Z]{3,}/.test(description ?? '')
}
