import { describe, expect, it } from 'vitest'
import {
  asLengthUnit,
  createUnitFormat,
  asWeightUnit,
  cmForDisplay,
  cmForStorage,
  cmToDisplay,
  displayRange,
  displayToCm,
  displayToKg,
  feetInches,
  kgForDisplay,
  kgForStorage,
  kgToDisplay,
  LENGTH_STEPS,
  parseDecimal,
  parseLengthInput,
  parseWeightInput,
  roundBodyWeight,
  roundLoad,
  roundTo,
  roundToStep,
  WEIGHT_STEPS,
} from './units'

describe('conversions', () => {
  it('uses the exact definitions', () => {
    expect(displayToKg(1, 'lb')).toBe(0.45359237)
    expect(displayToCm(1, 'in')).toBe(2.54)
    expect(kgToDisplay(0.45359237, 'lb')).toBeCloseTo(1, 12)
    expect(cmToDisplay(2.54, 'in')).toBeCloseTo(1, 12)
  })
  it('is the identity for metric', () => {
    expect(kgToDisplay(82.5, 'kg')).toBe(82.5)
    expect(displayToKg(82.5, 'kg')).toBe(82.5)
    expect(cmToDisplay(178, 'cm')).toBe(178)
    expect(displayToCm(178, 'cm')).toBe(178)
  })
  it('round-trips', () => {
    for (const v of [0, 1, 45, 100, 225.5, 881.5]) {
      expect(kgToDisplay(displayToKg(v, 'lb'), 'lb')).toBeCloseTo(v, 9)
      expect(cmToDisplay(displayToCm(v, 'in'), 'in')).toBeCloseTo(v, 9)
    }
  })
  it('falls back to metric for unknown settings', () => {
    expect(asWeightUnit('lb')).toBe('lb')
    expect(asWeightUnit(null)).toBe('kg')
    expect(asWeightUnit('stone')).toBe('kg')
    expect(asLengthUnit('in')).toBe('in')
    expect(asLengthUnit(undefined)).toBe('cm')
  })
})

describe('rounding', () => {
  it('rounds half away from zero without float noise', () => {
    expect(roundTo(82.35, 1)).toBe(82.4)
    expect(roundTo(1.005, 2)).toBe(1.01)
    expect(roundTo(-1.25, 1)).toBe(-1.3)
    expect(roundTo(-0.04, 1)).toBe(0)
    expect(Object.is(roundTo(-0.04, 1), -0)).toBe(false)
  })
  it('snaps to a step', () => {
    expect(roundToStep(180.12, 0.5)).toBe(180)
    expect(roundToStep(180.3, 0.5)).toBe(180.5)
    expect(roundToStep(0.1 + 0.2, 0.1)).toBe(0.3)
  })
  it('keeps quarter loads, otherwise one decimal', () => {
    expect(roundLoad(21.25, 'kg')).toBe(21.25)
    expect(roundLoad(82.5, 'kg')).toBe(82.5)
    expect(roundLoad(21.3, 'kg')).toBe(21.3)
    expect(roundLoad(102.06, 'kg')).toBe(102.1)
    expect(roundLoad(132.277, 'lb')).toBe(132.3)
    expect(roundLoad(134.99, 'lb')).toBe(135)
  })
  it('puts lb body weights on a 0.5 grid and kg on 0.1', () => {
    expect(roundBodyWeight(81.74, 'kg')).toBe(81.7)
    expect(roundBodyWeight(180.12, 'lb')).toBe(180)
    expect(roundBodyWeight(180.56, 'lb')).toBe(180.5)
  })
})

describe('display <-> storage', () => {
  it('converts loads at 0.01 kg and shows them back as typed', () => {
    expect(kgForStorage(135, 'lb', 'load')).toBe(61.23)
    expect(kgForDisplay(61.23, 'lb', 'load')).toBe(135)
    expect(kgForStorage(21.25, 'kg', 'load')).toBe(21.25)
    expect(kgForDisplay(21.25, 'kg', 'load')).toBe(21.25)
    // a kg entry seen by an lb user: one decimal, not snapped to a plate
    expect(kgForDisplay(60, 'lb', 'load')).toBe(132.3)
    expect(kgForDisplay(100, 'lb', 'load')).toBe(220.5)
    expect(kgForDisplay(102.06, 'kg', 'load')).toBe(102.1)
  })
  it('survives the round trip for every lb load a stepper or keypad can produce', () => {
    for (let lb = 0; lb <= 1000; lb += 0.5) expect(kgForDisplay(kgForStorage(lb, 'lb', 'load'), 'lb', 'load')).toBe(lb)
    for (let lb = 0; lb <= 300; lb += 0.1) {
      const v = roundTo(lb, 1)
      expect(kgForDisplay(kgForStorage(v, 'lb', 'load'), 'lb', 'load')).toBe(v)
    }
  })
  it('survives the round trip for body weights on the lb grid', () => {
    for (let lb = 45; lb <= 880; lb += 0.5) expect(kgForDisplay(kgForStorage(lb, 'lb', 'body'), 'lb', 'body')).toBe(lb)
    for (let kg = 20; kg <= 400; kg += 0.1) {
      const v = roundTo(kg, 1)
      expect(kgForDisplay(kgForStorage(v, 'kg', 'body'), 'kg', 'body')).toBe(v)
    }
  })
  it('stores body weight at 0.1 kg', () => {
    expect(kgForStorage(180.5, 'lb', 'body')).toBe(81.9)
    expect(kgForStorage(80.04, 'kg', 'body')).toBe(80)
  })
  it('converts lengths at 0.1 cm and shows one decimal', () => {
    expect(cmForStorage(32.5, 'in')).toBe(82.6)
    expect(cmForDisplay(82.6, 'in')).toBe(32.5)
    expect(cmForDisplay(178, 'in')).toBe(70.1)
    expect(cmForStorage(70.5, 'in')).toBe(179.1)
    expect(cmForDisplay(179.1, 'in')).toBe(70.5)
    expect(cmForDisplay(88.25, 'cm')).toBe(88.3)
    for (let i = 4; i <= 118; i += 0.5) expect(cmForDisplay(cmForStorage(i, 'in'), 'in')).toBe(i)
  })
  it('formats height as feet and inches', () => {
    expect(feetInches(178)).toEqual({ ft: 5, inch: 10 })
    expect(feetInches(182.88)).toEqual({ ft: 6, inch: 0 })
    // 71.9 in rounds to 72 = 6'0", never 5'12"
    expect(feetInches(182.6)).toEqual({ ft: 6, inch: 0 })
    expect(feetInches(152.4)).toEqual({ ft: 5, inch: 0 })
  })
})

describe('input', () => {
  it('parses decimal text with comma or dot', () => {
    expect(parseDecimal('82,5')).toBe(82.5)
    expect(parseDecimal(' 80 ')).toBe(80)
    expect(parseDecimal('80.')).toBe(80)
    expect(parseDecimal('.5')).toBe(0.5)
    expect(parseDecimal('')).toBeNull()
    expect(parseDecimal('abc')).toBeNull()
    expect(parseDecimal('-3')).toBeNull()
  })
  it('turns typed text into metric', () => {
    expect(parseWeightInput('135', 'lb', 'load')).toBe(61.23)
    expect(parseWeightInput('82,5', 'kg', 'load')).toBe(82.5)
    expect(parseWeightInput('180,5', 'lb', 'body')).toBe(81.9)
    expect(parseWeightInput('x', 'lb', 'body')).toBeNull()
    expect(parseLengthInput('32.5', 'in')).toBe(82.6)
    expect(parseLengthInput('88', 'cm')).toBe(88)
    expect(parseLengthInput('', 'in')).toBeNull()
  })
})

describe('steppers', () => {
  it('steps like a lifter loads a bar', () => {
    expect(WEIGHT_STEPS.load).toEqual({ kg: 2.5, lb: 5 })
    expect(WEIGHT_STEPS.body).toEqual({ kg: 0.1, lb: 0.5 })
    expect(WEIGHT_STEPS.target).toEqual({ kg: 0.5, lb: 1 })
    expect(LENGTH_STEPS.circumference).toEqual({ cm: 0.5, in: 0.5 })
    expect(LENGTH_STEPS.height).toEqual({ cm: 1, in: 0.5 })
  })
  it('expresses DB ranges in display units, inside the check', () => {
    const lb = (kg: number) => kgToDisplay(kg, 'lb')
    const [lo, hi] = displayRange(20, 400, lb, 0.5)
    expect([lo, hi]).toEqual([44.5, 881.5])
    expect(kgForStorage(lo, 'lb', 'body')).toBeGreaterThanOrEqual(20)
    expect(kgForStorage(hi, 'lb', 'body')).toBeLessThanOrEqual(400)
    expect(displayRange(100, 250, (cm) => cmToDisplay(cm, 'in'), 0.5)).toEqual([39.5, 98])
    expect(displayRange(20, 400, (kg) => kg, 0.1)).toEqual([20, 400])
  })
})

describe('createUnitFormat', () => {
  const tr = createUnitFormat('kg', 'cm', 'tr')
  const en = createUnitFormat('lb', 'in', 'en')
  it('formats metric in Turkish', () => {
    expect(tr.load(82.5)).toBe('82,5')
    expect(tr.load(21.25)).toBe('21,25')
    expect(tr.load(80)).toBe('80')
    expect(tr.volume(7845.4)).toBe('7.845')
    expect(tr.body(80)).toBe('80,0')
    expect(tr.len(88.25)).toBe('88,3')
    expect(tr.heightCm(178.4)).toBe('178')
    expect(tr.signed(-1.2)).toBe('−1,2')
    expect(tr.signed(0)).toBe('0,0')
  })
  it('formats imperial in English', () => {
    expect(en.load(61.23)).toBe('135')
    expect(en.load(60)).toBe('132.3')
    expect(en.volume(7845)).toBe('17,295')
    expect(en.estimate(104.5)).toBe('230.4')
    expect(en.body(81.7)).toBe('180.0')
    expect(en.bodyAverage(81.7)).toBe('180.1')
    expect(en.len(82.6)).toBe('32.5')
    expect(en.signed(2.5)).toBe('+2.5')
  })
  it('diffs readings as displayed', () => {
    // 81.7 kg -> 180.0 lb, 77.1 kg -> 170.0 lb: the user sees exactly 10
    expect(en.bodyDiff(77.1, 81.7)).toBe(10)
    expect(tr.bodyDiff(80, 78.6)).toBe(-1.4)
    expect(en.lengthDiff(88, 82.6)).toBe(-2.1)
    expect(en.weightDelta(-1)).toBe(-2.2)
    expect(tr.weightDelta(-0.44)).toBe(-0.4)
  })
  it('converts both ways at storage precision', () => {
    expect(en.kg(61.23)).toBe(135)
    expect(en.toKg(135)).toBe(61.23)
    expect(en.toKg(180.5, 'body')).toBe(81.9)
    expect(en.kg(81.9, 'body')).toBe(180.5)
    expect(en.toCm(32.5)).toBe(82.6)
    expect(en.steps).toEqual({ load: 5, body: 0.5, target: 1, circumference: 0.5, height: 0.5 })
    expect(tr.steps).toEqual({ load: 2.5, body: 0.1, target: 0.5, circumference: 0.5, height: 1 })
    expect(en.weightRange(20, 400, en.steps.body)).toEqual([44.5, 881.5])
  })
})
