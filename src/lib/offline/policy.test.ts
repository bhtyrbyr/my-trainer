import { describe, expect, it } from 'vitest'
import { isPersistableKey } from './policy'

describe('isPersistableKey', () => {
  it('never persists social data (other users content)', () => {
    expect(isPersistableKey(['social', 'feed', 'following'])).toBe(false)
    expect(isPersistableKey(['social', 'profile', 'u1'])).toBe(false)
    expect(isPersistableKey(['social', 'notifications'])).toBe(false)
  })
  it('still persists own rows', () => {
    expect(isPersistableKey(['workouts', 'history'])).toBe(true)
  })
})
