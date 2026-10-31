import { expect, test } from '@playwright/test'
import { E2E_EXERCISE } from './support/env'

test('empty session: add an exercise, log 3 sets, finish, see it in history', async ({ page }) => {
  await page.goto('/workouts')
  await page.getByRole('button', { name: 'Start an empty workout' }).click()
  await expect(page).toHaveURL(/\/workouts\/session\//)

  await page.getByRole('button', { name: 'Add exercise' }).click()
  await page.getByRole('searchbox').fill('E2E')
  await page.getByRole('button', { name: new RegExp(E2E_EXERCISE) }).click()
  await expect(page.getByRole('heading', { level: 1, name: E2E_EXERCISE })).toBeVisible()

  await page.getByRole('button', { name: 'Increase by 2.5 kg' }).click()
  await page.getByRole('button', { name: 'One rep more' }).click()
  for (let set = 1; set <= 3; set++) {
    await expect(page.getByRole('region', { name: `Set ${set}` })).toBeVisible()
    await page.getByRole('button', { name: 'Complete set' }).click()
    await page.getByRole('button', { name: 'Skip rest' }).click()
  }
  await expect(page.getByRole('button', { name: `Exercise 1: ${E2E_EXERCISE}, 3/– sets` })).toBeVisible()

  await page.getByRole('button', { name: 'Finish', exact: true }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Finish workout?' })
  await expect(confirm).toContainText('3 sets')
  await confirm.getByRole('button', { name: 'Finish and save' }).click()

  // the saved session opens from history
  await expect(page).toHaveURL(/\/workouts\/history\/[0-9a-f-]{36}$/)
  const exercise = page.getByRole('region', { name: E2E_EXERCISE })
  await expect(exercise.getByRole('listitem')).toHaveCount(3)

  await page.getByRole('link', { name: 'Back' }).click()
  await expect(page).toHaveURL(/\/workouts\/history$/)
  await expect(page.getByRole('gridcell', { name: /trained/ })).toHaveCount(1)
  await expect(page.getByRole('link', { name: /Free workout/ }).first()).toBeVisible()
})
