/**
 * Units of measure (docs/faz4-spec.md section 2). Storage is metric everywhere (kg, cm); these pure
 * helpers convert at the view layer only. Labels ("kg", "lb", "cm", "in") come from common:units.*;
 * the React side is `useUnits()` in src/features/settings/useUnits.ts.
 *
 * Display precision is chosen per kind of value, because the database stores them at different
 * precisions and a value must survive "type it, save it, see it again" unchanged:
 * - load (set weights, numeric(6,2) kg): quarter values (21.25 kg, 2.5 lb plates) are shown as typed,
 *   anything else with at most 1 decimal. Error of the 0.01 kg storage is < 0.012 lb.
 * - body weight (weigh-ins, target, numeric(5,1) kg): kg 1 decimal; lb on a 0.5 lb grid, since
 *   0.1 kg = 0.22 lb and a finer lb grid would drift after a round trip (180.2 lb -> 81.7 kg -> 180.1 lb).
 * - lengths (circumferences, height, numeric(5,1) cm): 1 decimal in either unit.
 * - computed figures (averages, e1RM, changes): 1 decimal, never snapped; totals (volume): whole numbers.
 */

export type WeightUnit = 'kg' | 'lb'
export type LengthUnit = 'cm' | 'in'

/** Exact by definition (international yard and pound agreement, 1959). */
export const KG_PER_LB = 0.45359237
export const CM_PER_IN = 2.54

export const WEIGHT_UNITS: readonly WeightUnit[] = ['kg', 'lb']
export const LENGTH_UNITS: readonly LengthUnit[] = ['cm', 'in']
export const DEFAULT_WEIGHT_UNIT: WeightUnit = 'kg'
export const DEFAULT_LENGTH_UNIT: LengthUnit = 'cm'

/** Anything that is not exactly 'lb' / 'in' (null, unknown text from the DB) falls back to metric. */
export const asWeightUnit = (v: unknown): WeightUnit => (v === 'lb' ? 'lb' : DEFAULT_WEIGHT_UNIT)
export const asLengthUnit = (v: unknown): LengthUnit => (v === 'in' ? 'in' : DEFAULT_LENGTH_UNIT)

// -----------------------------------------------------------------------------
// Conversions (exact, unrounded)
// -----------------------------------------------------------------------------
export function kgToDisplay(kg: number, unit: WeightUnit): number {
  return unit === 'kg' ? kg : kg / KG_PER_LB
}
export function displayToKg(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? value : value * KG_PER_LB
}
export function cmToDisplay(cm: number, unit: LengthUnit): number {
  return unit === 'cm' ? cm : cm / CM_PER_IN
}
export function displayToCm(value: number, unit: LengthUnit): number {
  return unit === 'cm' ? value : value * CM_PER_IN
}

// -----------------------------------------------------------------------------
// Rounding
// -----------------------------------------------------------------------------
/** Half away from zero at `decimals`, robust to float noise (82.35 -> 82.4, 1.005 -> 1.01). */
export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals
  const r = (Math.sign(value) * Math.round(Math.abs(value) * f + 1e-7)) / f
  return r === 0 ? 0 : r
}

/** Nearest multiple of `step` (0.5 -> 80.25 becomes 80.5). */
export function roundToStep(value: number, step: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 1)
  return roundTo(Math.round(value / step + 1e-9) * step, decimals)
}

/** Within this distance of a quarter value, a load is shown as that quarter (storage noise, see header). */
const LOAD_SNAP: Record<WeightUnit, number> = { kg: 0.001, lb: 0.012 }

/** A set weight already in the display unit: quarter values kept, everything else 1 decimal. */
export function roundLoad(value: number, unit: WeightUnit): number {
  const quarter = Math.round(value * 4) / 4
  if (Math.abs(value - quarter) <= LOAD_SNAP[unit]) return quarter
  return roundTo(value, 1)
}

/** A body-weight reading already in the display unit: 0.1 kg or 0.5 lb. */
export function roundBodyWeight(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? roundTo(value, 1) : roundToStep(value, 0.5)
}

/** A circumference or height already in the display unit: 1 decimal. */
export function roundLength(value: number): number {
  return roundTo(value, 1)
}

// -----------------------------------------------------------------------------
// Display <-> storage
// -----------------------------------------------------------------------------
export type WeightKind = 'load' | 'body'

/** Stored kg -> the number a user should see (and a stepper should start from). */
export function kgForDisplay(kg: number, unit: WeightUnit, kind: WeightKind): number {
  const v = kgToDisplay(kg, unit)
  return kind === 'load' ? roundLoad(v, unit) : roundBodyWeight(v, unit)
}

/** Display value -> kg at the column's precision (loads 0.01 kg, body weights 0.1 kg). */
export function kgForStorage(value: number, unit: WeightUnit, kind: WeightKind): number {
  return roundTo(displayToKg(value, unit), kind === 'load' ? 2 : 1)
}

/** Stored cm -> displayed length. */
export function cmForDisplay(cm: number, unit: LengthUnit): number {
  return roundLength(cmToDisplay(cm, unit))
}

/** Display length -> cm at the column's precision (0.1 cm). */
export function cmForStorage(value: number, unit: LengthUnit): number {
  return roundTo(displayToCm(value, unit), 1)
}

/** Height as feet + whole inches (5'10"), rounding 11.6 in up to the next foot. */
export function feetInches(cm: number): { ft: number; inch: number } {
  const total = Math.round(cm / CM_PER_IN)
  return { ft: Math.floor(total / 12), inch: total % 12 }
}

// -----------------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------------
/** Accepts "82,5", "82.5", " 80 ", "80." -> number; empty or garbage -> null. */
export function parseDecimal(input: string): number | null {
  const s = input.trim().replace(',', '.')
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Typed text in the user's unit -> kg for storage, or null when it is not a number. */
export function parseWeightInput(input: string, unit: WeightUnit, kind: WeightKind): number | null {
  const n = parseDecimal(input)
  return n === null ? null : kgForStorage(n, unit, kind)
}

/** Typed text in the user's unit -> cm for storage, or null when it is not a number. */
export function parseLengthInput(input: string, unit: LengthUnit): number | null {
  const n = parseDecimal(input)
  return n === null ? null : cmForStorage(n, unit)
}

// -----------------------------------------------------------------------------
// Steppers
// -----------------------------------------------------------------------------
/**
 * What one tap on +/- should add, in the display unit.
 * - load: the smallest common plate pair (2 x 1.25 kg, 2 x 2.5 lb). Dumbbell racks go up in the same steps.
 * - body: what a bathroom scale resolves (0.1 kg); lb uses the 0.5 lb display grid (see header).
 * - target: a goal is not that precise; 0.5 kg / 1 lb.
 */
export const WEIGHT_STEPS: Record<WeightKind | 'target', Record<WeightUnit, number>> = {
  load: { kg: 2.5, lb: 5 },
  body: { kg: 0.1, lb: 0.5 },
  target: { kg: 0.5, lb: 1 },
}

/** Tape measures read to 0.5 cm or 1/2 in; height to 1 cm or 1/2 in. */
export const LENGTH_STEPS: Record<'circumference' | 'height', Record<LengthUnit, number>> = {
  circumference: { cm: 0.5, in: 0.5 },
  height: { cm: 1, in: 0.5 },
}

/**
 * A metric range (the DB check) expressed in the display unit, pulled inwards to the step grid so the
 * converted value of either end still passes the check (400 kg -> 881.5 lb, not 881.8).
 */
export function displayRange(min: number, max: number, toDisplay: (metric: number) => number, step: number): [number, number] {
  const lo = toDisplay(min)
  const hi = toDisplay(max)
  const ceil = roundToStep(Math.ceil(lo / step - 1e-9) * step, step)
  const floor = roundToStep(Math.floor(hi / step + 1e-9) * step, step)
  return [ceil, floor]
}

// -----------------------------------------------------------------------------
// Formatting (numbers only; the hook adds the i18n unit label)
// -----------------------------------------------------------------------------
/**
 * Locale-aware number strings for every kind of weight / length. Inputs are stored metric values
 * unless the name ends in `Value` (already in the display unit, e.g. a stepper's state).
 * Negative numbers use a real minus sign (−).
 */
export function createUnitFormat(weight: WeightUnit, length: LengthUnit, locale: string) {
  const nf = (min: number, max: number, signed = false) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max, signDisplay: signed ? 'exceptZero' : 'auto' })
  const upTo2 = nf(0, 2)
  const upTo1 = nf(0, 1)
  const whole = nf(0, 0)
  const one = nf(1, 1)
  const signedOne = nf(1, 1, true)
  const minus = (s: string) => s.replace('-', '−')
  const bodyOf = (kg: number) => kgForDisplay(kg, weight, 'body')

  return {
    weight,
    length,
    /** stored kg -> display number (rounded for the kind) */
    kg: (kg: number, kind: WeightKind = 'load') => kgForDisplay(kg, weight, kind),
    /** display number -> kg at storage precision */
    toKg: (value: number, kind: WeightKind = 'load') => kgForStorage(value, weight, kind),
    /** stored cm -> display number */
    cm: (cm: number) => cmForDisplay(cm, length),
    /** display number -> cm at storage precision */
    toCm: (value: number) => cmForStorage(value, length),

    /** set weight: "82,5" / "21,25" / "135" */
    load: (kg: number) => upTo2.format(kgForDisplay(kg, weight, 'load')),
    loadValue: (value: number) => upTo2.format(roundLoad(value, weight)),
    /** volume totals: whole numbers, grouped */
    volume: (kg: number) => whole.format(kgToDisplay(kg, weight)),
    /** computed weights (averages, e1RM): one decimal at most */
    estimate: (kg: number) => upTo1.format(roundTo(kgToDisplay(kg, weight), 1)),
    /** chart axis / tooltip for numbers already converted */
    estimateValue: (value: number) => upTo1.format(roundTo(value, 1)),

    /** body-weight reading: always one decimal ("80,0") */
    body: (kg: number) => one.format(bodyOf(kg)),
    bodyValue: (value: number) => one.format(roundBodyWeight(value, weight)),
    /** computed body weights (7-day average): one decimal, not snapped */
    bodyAverage: (kg: number) => one.format(roundTo(kgToDisplay(kg, weight), 1)),
    /** difference of two readings as the user sees them (keeps "180 − 170 = 10" honest in lb) */
    bodyDiff: (fromKg: number, toKg: number) => roundTo(bodyOf(toKg) - bodyOf(fromKg), 1),
    /** a computed weight difference (kg) in the user's unit, 1 decimal */
    weightDelta: (kg: number) => roundTo(kgToDisplay(kg, weight), 1),
    /** "+1,5" / "−0,4" / "0,0" for a number already in the display unit */
    signed: (value: number) => minus(signedOne.format(value)),
    oneDecimal: (value: number) => one.format(value),

    /** circumference: one decimal */
    len: (cm: number) => one.format(cmForDisplay(cm, length)),
    lengthValue: (value: number) => one.format(roundLength(value)),
    lengthDiff: (fromCm: number, toCm: number) => roundTo(cmForDisplay(toCm, length) - cmForDisplay(fromCm, length), 1),
    /** height in cm as a whole number ("178"); the hook renders inches as feet + inches */
    heightCm: (cm: number) => whole.format(Math.round(cm)),

    steps: {
      load: WEIGHT_STEPS.load[weight],
      body: WEIGHT_STEPS.body[weight],
      target: WEIGHT_STEPS.target[weight],
      circumference: LENGTH_STEPS.circumference[length],
      height: LENGTH_STEPS.height[length],
    },
    /** metric DB range -> display range on the step grid */
    weightRange: (minKg: number, maxKg: number, step: number) => displayRange(minKg, maxKg, (kg) => kgToDisplay(kg, weight), step),
    lengthRange: (minCm: number, maxCm: number, step: number) => displayRange(minCm, maxCm, (cm) => cmToDisplay(cm, length), step),
  }
}

export type UnitFormat = ReturnType<typeof createUnitFormat>
