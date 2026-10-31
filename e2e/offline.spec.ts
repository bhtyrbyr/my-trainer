import { expect, test } from '@playwright/test'
import { restAsUser } from './support/env'

test('offline writes are queued and sync when back online', async ({ page, context }) => {
  const name = `Offline ${Date.now().toString(36)}`
  await page.goto('/track')
  const agenda = page.getByRole('region', { name: 'Habits and to-dos' })
  await agenda.getByRole('button', { name: 'Habit', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Add habit' })
  await sheet.getByRole('textbox', { name: 'Name' }).fill(name)
  await sheet.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(agenda.getByRole('button', { name: `Mark ${name} as done` })).toBeVisible()
  const [habit] = await restAsUser<{ id: string }[]>(`habits?select=id&name=eq.${encodeURIComponent(name)}`)
  const waterBefore = (await restAsUser<unknown[]>('water_entries?select=id')).length

  await context.setOffline(true)
  await agenda.getByRole('button', { name: `Mark ${name} as done` }).click()
  await page.getByRole('region', { name: 'Sleep and water' }).getByRole('button', { name: 'Add 250 ml of water' }).click()
  // optimistic UI while offline
  await expect(agenda.getByRole('button', { name: `Unmark ${name}` })).toBeVisible()
  await page.waitForTimeout(500)
  expect(await restAsUser<unknown[]>(`habit_logs?select=id&habit_id=eq.${habit!.id}`)).toHaveLength(0)

  await context.setOffline(false)
  await expect.poll(async () => (await restAsUser<unknown[]>(`habit_logs?select=id&habit_id=eq.${habit!.id}`)).length, { timeout: 15_000 }).toBe(1)
  await expect.poll(async () => (await restAsUser<unknown[]>('water_entries?select=id')).length, { timeout: 15_000 }).toBe(waterBefore + 1)
})
