import { describe, expect, it } from 'vitest'
import { muscleMapPaths, resolveMuscleMap, type Muscle, type MuscleCatalog } from './muscles'

const m = (wger_id: number, is_front: boolean): Muscle => ({
  wger_id,
  name_latin: `m${wger_id}`,
  name_en: `m${wger_id}`,
  name_tr: null,
  is_front,
  svg_main_path: `muscles/main/${wger_id}.svg`,
  svg_secondary_path: `muscles/secondary/${wger_id}.svg`,
})

const catalog: MuscleCatalog = {
  muscles: [m(4, true), m(5, false), m(2, true), m(9, false)],
  aliases: { pectorals: 4, triceps: 5, deltoids: 2, 'upper back': 9, trapezius: 9, 'rotator cuff': null },
}

describe('resolveMuscleMap', () => {
  it('splits target and secondary overlays', () => {
    const out = resolveMuscleMap(['pectorals'], ['triceps', 'deltoids'], catalog)
    expect(out.main.map((x) => x.wger_id)).toEqual([4])
    expect(out.secondary.map((x) => x.wger_id)).toEqual([2, 5])
    expect(out.unmapped).toEqual([])
  })
  it('does not repeat a target muscle as secondary and merges aliases to one overlay', () => {
    const out = resolveMuscleMap(['upper back'], ['trapezius', 'pectorals'], catalog)
    expect(out.main.map((x) => x.wger_id)).toEqual([9])
    expect(out.secondary.map((x) => x.wger_id)).toEqual([4])
  })
  it('lists names without a wger overlay as text, once', () => {
    const out = resolveMuscleMap(['rotator cuff'], ['rotator cuff', 'hands', 'Pectorals'], catalog)
    expect(out.main).toEqual([])
    expect(out.unmapped).toEqual(['rotator cuff', 'hands'])
    expect(out.secondary.map((x) => x.wger_id)).toEqual([4])
  })
  it('treats everything as unmapped until the catalog loads', () => {
    expect(resolveMuscleMap(['pectorals'], [], undefined).unmapped).toEqual(['pectorals'])
  })
})

describe('muscleMapPaths', () => {
  it('collects silhouettes and overlay paths', () => {
    const out = muscleMapPaths(resolveMuscleMap(['pectorals'], ['triceps'], catalog))
    expect(out).toEqual(['muscles/front.svg', 'muscles/back.svg', 'muscles/main/4.svg', 'muscles/secondary/5.svg'])
  })
})
