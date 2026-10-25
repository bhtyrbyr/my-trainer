import { describe, expect, it } from 'vitest'
import tr from '@/locales/tr/exercises.json'
import en from '@/locales/en/exercises.json'
import { vocabKey } from './name'

// Every value present in the ExerciseDB catalog (1500 exercises, snapshot 2026-10-25).
const BODY_PARTS = ['back', 'cardio', 'chest', 'lower arms', 'lower legs', 'neck', 'shoulders', 'upper arms', 'upper legs', 'waist']
const MUSCLES = [
  'abdominals', 'abductors', 'adductors', 'ankle stabilizers', 'ankles', 'back', 'biceps', 'brachialis', 'calves',
  'cardiovascular system', 'core', 'deltoids', 'erector spinae', 'feet', 'forearms', 'glutes', 'grip muscles',
  'hamstrings', 'hands', 'hip flexors', 'latissimus dorsi', 'levator scapulae', 'obliques', 'pectorals', 'quadriceps',
  'rear deltoids', 'rhomboids', 'rotator cuff', 'serratus anterior', 'soleus', 'sternocleidomastoid',
  'tibialis anterior', 'trapezius', 'triceps', 'upper back', 'wrist extensors', 'wrist flexors', 'wrists',
]
const EQUIPMENT = [
  'EZ bar', 'ab wheel', 'assisted', 'barbell', 'bodyweight', 'bosu ball', 'cable', 'dumbbell', 'elliptical machine',
  'hammer', 'kettlebell', 'leverage machine', 'medicine ball', 'olympic barbell', 'resistance band', 'roller', 'rope',
  'ski ergometer', 'sled machine', 'smith machine', 'stability ball', 'stationary bike', 'stepmill machine',
  'suspension trainer', 'tennis ball', 'tire', 'towel', 'trap bar', 'upper body ergometer', 'weighted',
]

describe('catalog vocabulary', () => {
  it.each([
    ['bodyPart', BODY_PARTS, 10],
    ['muscle', MUSCLES, 38],
    ['equipment', EQUIPMENT, 30],
  ] as const)('%s has a TR and EN label for every catalog value', (kind, values, n) => {
    expect(values).toHaveLength(n)
    const keys = values.map(vocabKey)
    expect(new Set(keys).size).toBe(n)
    for (const k of keys) {
      expect((tr[kind] as Record<string, string>)[k], `tr ${kind}.${k}`).toBeTruthy()
      expect((en[kind] as Record<string, string>)[k], `en ${kind}.${k}`).toBeTruthy()
    }
    expect(Object.keys(tr[kind])).toHaveLength(n)
  })
})
