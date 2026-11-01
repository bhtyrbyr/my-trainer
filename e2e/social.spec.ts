import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { STATE_FILE_B, rpcAs, testUser, testUserB } from './support/env'

const brand = JSON.parse(readFileSync(new URL('../src/config/brand.json', import.meta.url), 'utf8')) as {
  legal: { socialConsentVersion: string }
}
// 8x8 opaque PNG: the composer downscales and re-encodes it on the device before the upload
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGM48cEGK2IYWhIA+ph9AZUYsvoAAAAASUVORK5CYII=',
  'base64',
)

/**
 * Two people, two browser contexts: A joins Community (private by default), B asks to follow, A accepts
 * from the notifications, A posts to followers with one photo, B sees it in the feed, B blocks A and the
 * post is gone.
 */
test('Community: private follow, post with a photo, block hides it', async ({ page: a, browser }) => {
  test.setTimeout(120_000)
  const A = testUser()
  const B = testUserB()
  const text = `Social e2e ${Date.now().toString(36)}`

  // A joins through the intro (KVKK consent checkbox, then social_enable)
  await a.goto('/social')
  await a.getByRole('checkbox').check()
  await a.getByRole('button', { name: 'Join Community' }).click()
  await expect(a.getByRole('tab', { name: 'Home' })).toBeVisible()
  // B joins through the same RPC the intro calls
  await rpcAs(B, 'social_enable', { p_consent_version: brand.legal.socialConsentVersion })

  // B asks to follow A (A is private)
  const ctxB = await browser.newContext({ storageState: STATE_FILE_B })
  const b = await ctxB.newPage()
  await b.goto(`/social/u/${A.id}`)
  await expect(b.getByText('This account is private')).toBeVisible()
  await b.getByRole('button', { name: 'Request to follow' }).click()
  await expect(b.getByRole('button', { name: 'Requested' })).toBeVisible()

  // A accepts from the notifications inbox
  await a.goto('/social/notifications')
  const request = a.getByRole('listitem').filter({ hasText: 'wants to follow you' })
  await request.getByRole('button', { name: 'Accept' }).click()
  await expect(request.getByText('Accepted')).toBeVisible()

  // A posts to followers (the composer's default audience) with one photo
  await a.goto('/social')
  await a.getByRole('button', { name: 'Share' }).click()
  await expect(a.getByRole('dialog', { name: 'New post' })).toBeVisible()
  const composer = a.getByRole('dialog') // titled "Share a photo" once a photo is added
  await composer.getByRole('textbox', { name: 'Text' }).fill(text)
  await composer
    .locator('input[type="file"]:not([capture])')
    .setInputFiles({ name: 'e2e.png', mimeType: 'image/png', buffer: PNG })
  await expect(composer.getByRole('button', { name: 'Remove photo 1' })).toBeVisible()
  await composer.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(composer).toBeHidden()
  await expect(a.getByRole('article').filter({ hasText: text })).toBeVisible()

  // B sees it, photo included
  await b.goto('/social')
  const post = b.getByRole('article').filter({ hasText: text })
  await expect(post).toBeVisible()
  await expect(post.locator('img').last()).toBeVisible()
  const feed = await rpcAs<{ body: string; media: unknown[] }[]>(B, 'social_feed', {})
  expect(feed.find((p) => p.body === text)?.media).toHaveLength(1)

  // B blocks A: the post disappears from B's feed
  await b.goto(`/social/u/${A.id}`)
  await b.getByRole('button', { name: 'More options' }).click()
  await b.getByRole('dialog', { name: 'More options' }).getByRole('button', { name: 'Block' }).click()
  await b.getByRole('alertdialog').getByRole('button', { name: 'Block' }).click()
  await expect(b).toHaveURL(/\/social$/)
  await expect(b.getByText(text)).toHaveCount(0)
  expect((await rpcAs<{ body: string }[]>(B, 'social_feed', {})).some((p) => p.body === text)).toBe(false)

  await ctxB.close()
})
