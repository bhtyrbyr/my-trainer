import { expect, test } from '@playwright/test'
import { restAsUser } from './support/env'

test('Track: create a habit and tick it', async ({ page }) => {
  const name = `Habit ${Date.now().toString(36)}`
  await page.goto('/track')
  const agenda = page.getByRole('region', { name: 'Habits and to-dos' })
  await agenda.getByRole('button', { name: 'Habit', exact: true }).click()

  const sheet = page.getByRole('dialog', { name: 'Add habit' })
  await sheet.getByRole('textbox', { name: 'Name' }).fill(name)
  await sheet.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(sheet).toBeHidden()

  await agenda.getByRole('button', { name: `Mark ${name} as done` }).click()
  await expect(agenda.getByRole('button', { name: `Unmark ${name}` })).toBeVisible()
  // the tick reached the database (read back with the user's own token, RLS applies)
  const [habit] = await restAsUser<{ id: string }[]>(`habits?select=id&name=eq.${encodeURIComponent(name)}`)
  await expect.poll(async () => (await restAsUser<unknown[]>(`habit_logs?select=id&habit_id=eq.${habit!.id}`)).length).toBe(1)
  // a reload right away shows the server state, not the cached copy restored from IndexedDB
  await page.reload()
  await expect(page.getByRole('button', { name: `Unmark ${name}` })).toBeVisible()
})

test('Track: add 250 ml of water on the day view', async ({ page }) => {
  await page.goto('/track')
  const water = page.getByRole('region', { name: 'Sleep and water' })
  const total = water.getByRole('link', { name: 'Open sleep and water' })
  await expect(total).toContainText(/ml/)
  const before = Number((await total.innerText()).match(/([\d,]+)\s*\//)![1]!.replace(/,/g, ''))

  await water.getByRole('button', { name: 'Add 250 ml of water' }).click()
  await expect(total).toHaveText(new RegExp(`^Water\\s*${(before + 250).toLocaleString('en-US')}\\s*/`))
})
