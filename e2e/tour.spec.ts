import { expect, test } from '@playwright/test'
import { STATE_FILE_B, localStack, testUserB, type TestUser } from './support/env'

// The second test user, so a failure here can never leave the tour covering the main user's specs.
test.use({ storageState: STATE_FILE_B })

/** Reads or writes the user's own settings row with their token (RLS applies, like the app). */
async function settings(
  user: TestUser,
  patch?: { tour_completed_at: string | null },
): Promise<{ tour_completed_at: string | null }> {
  const { url, anonKey } = localStack()
  const r = await fetch(`${url}/rest/v1/user_settings?user_id=eq.${user.id}&select=tour_completed_at`, {
    method: patch ? 'PATCH' : 'GET',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${user.accessToken}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: patch ? JSON.stringify(patch) : undefined,
  })
  if (!r.ok) throw new Error(`user_settings: ${r.status} ${await r.text()}`)
  const [row] = (await r.json()) as { tour_completed_at: string | null }[]
  return row!
}

test('first-run tour: shown once, skipped, not shown again', async ({ page }) => {
  const user = testUserB()
  await settings(user, { tour_completed_at: null })

  await page.goto('/')
  const tour = page.getByRole('dialog', { name: 'App tour' })
  await expect(tour).toBeVisible()
  await expect(tour.getByRole('heading', { name: 'Training, food and habits in one place.' })).toBeVisible()
  await tour.getByRole('button', { name: 'Next' }).click()
  await expect(tour.getByRole('heading', { name: 'Plan it, get guided, get stronger.' })).toBeVisible()

  await tour.getByRole('button', { name: 'Skip' }).click()
  await expect(tour).toBeHidden()
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
  await expect.poll(async () => (await settings(user)).tour_completed_at).not.toBeNull()

  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
  await expect(tour).toHaveCount(0)
})
