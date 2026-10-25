import { describe, expect, it, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { clearUserData, forgetLastUser, isDifferentUser } from './clearUserData'

describe('clearUserData', () => {
  beforeEach(() => localStorage.clear())

  it('removes per-user drafts and the query cache, keeps unrelated keys', async () => {
    const qc = new QueryClient()
    qc.setQueryData(['workouts', 'x'], 1)
    localStorage.setItem('mt.workout.draft.abc', '{}')
    localStorage.setItem('mt.locale', 'tr')
    await clearUserData(qc)
    expect(qc.getQueryData(['workouts', 'x'])).toBeUndefined()
    expect(localStorage.getItem('mt.workout.draft.abc')).toBeNull()
    expect(localStorage.getItem('mt.locale')).toBe('tr')
  })
})

describe('isDifferentUser', () => {
  beforeEach(() => localStorage.clear())

  it('is false for the first user and the same user, true when the account changes', () => {
    expect(isDifferentUser('a')).toBe(false)
    expect(isDifferentUser('a')).toBe(false)
    expect(isDifferentUser('b')).toBe(true)
    forgetLastUser()
    expect(isDifferentUser('c')).toBe(false)
  })
})
