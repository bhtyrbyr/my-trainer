import { describe, expect, it, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { clearUserData, forgetLastUser, isDifferentUser } from './clearUserData'
import { persistGeneration } from '@/lib/offline/persister'

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

  it('drops the offline queue and invalidates every persister of the previous session', async () => {
    const qc = new QueryClient()
    qc.getMutationCache().build(qc, { mutationKey: ['offline', 'workouts', 'addSet'] })
    const before = persistGeneration.get()
    await clearUserData(qc)
    expect(qc.getMutationCache().getAll()).toHaveLength(0)
    expect(persistGeneration.get()).toBe(before + 1)
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
