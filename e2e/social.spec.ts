import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { STATE_FILE_B, rpcAs, testUser, testUserB, testUserC } from './support/env'

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

/**
 * Hashtags: A writes `#Deadlift` and `#İstanbul` (followers-only, A is private), both render as tag links,
 * Search > Tags finds `deadlift` from `#dead` and the tag page shows the post. B, a stranger (no follow,
 * no shared group), gets neither the post nor its tag through the tag page or the RPCs.
 * Runs after the test above (same two people); it resets their relation itself so it also runs alone.
 */
test('Community: hashtags link, search and respect privacy', async ({ page: a, browser }) => {
  test.setTimeout(120_000)
  const A = testUser()
  const B = testUserB()
  const stamp = Date.now().toString(36)
  const text = `Hashtag e2e ${stamp}`

  // both joined; no block and no follow either way, so B is a stranger to A
  for (const u of [A, B]) await rpcAs(u, 'social_enable', { p_consent_version: brand.legal.socialConsentVersion })
  await rpcAs(A, 'social_unblock', { p_user: B.id })
  await rpcAs(B, 'social_unblock', { p_user: A.id })
  await rpcAs(B, 'social_unfollow', { p_user: A.id })
  await rpcAs(A, 'social_remove_follower', { p_user: B.id })

  // A posts to followers (the composer's default audience)
  await a.goto('/social')
  await a.getByRole('button', { name: 'Share' }).click()
  const composer = a.getByRole('dialog', { name: 'New post' })
  await composer.getByRole('textbox', { name: 'Text' }).fill(`${text} pulls #Deadlift in #İstanbul`)
  await composer.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(composer).toBeHidden()

  // both tags render as links to their normalised tag pages (Turkish İ -> i)
  const post = a.getByRole('article').filter({ hasText: text })
  await expect(post).toBeVisible()
  await expect(post.getByRole('link', { name: '#Deadlift' })).toHaveAttribute('href', '/social/tag/deadlift')
  await expect(post.getByRole('link', { name: '#İstanbul' })).toHaveAttribute('href', '/social/tag/istanbul')

  // Search > Tags: "#dead" lists #deadlift, which opens the tag page with the post
  await a.goto('/social/search?s=tags')
  await a.getByRole('searchbox', { name: 'Search tags, e.g. #legday' }).fill('#dead')
  await a.getByRole('link', { name: /#deadlift/ }).click()
  await expect(a).toHaveURL(/\/social\/tag\/deadlift$/)
  await expect(a.getByRole('article').filter({ hasText: text })).toBeVisible()

  // the Profile tab opens on Posts with the author's own post; the header gear leads to Settings
  await a.goto('/me')
  await expect(a.getByRole('tab', { name: 'Posts', selected: true })).toBeVisible()
  await expect(a.getByRole('article').filter({ hasText: text })).toBeVisible()
  await a.getByRole('link', { name: 'Settings' }).click()
  await expect(a).toHaveURL(/\/settings$/)

  // the author's own view through the RPCs (the positive control for the stranger checks below)
  const own = await rpcAs<{ body: string }[]>(A, 'social_tag_posts', { p_tag: 'deadlift' })
  expect(own.some((p) => p.body?.startsWith(text))).toBe(true)

  // B, a stranger: the followers-only post is not on the tag page and its tag is not counted for B
  const ctxB = await browser.newContext({ storageState: STATE_FILE_B })
  const b = await ctxB.newPage()
  await b.goto('/social/tag/deadlift')
  await expect(b.getByRole('heading', { name: '#deadlift' })).toBeVisible()
  await b.waitForLoadState('networkidle')
  await expect(b.getByText(text)).toHaveCount(0)
  const seen = await rpcAs<{ body: string }[]>(B, 'social_tag_posts', { p_tag: 'deadlift' })
  expect(seen.some((p) => p.body?.startsWith(text))).toBe(false)
  const istanbul = await rpcAs<{ body: string }[]>(B, 'social_tag_posts', { p_tag: 'İstanbul' })
  expect(istanbul.some((p) => p.body?.startsWith(text))).toBe(false)
  await ctxB.close()
})

/**
 * Mentions: B follows A (accepted), so A may tag B in a followers-only post; C, a joined stranger, is not
 * offered. A picks B from the composer's suggestions, B sees the @link, a mention notification and the
 * post under Profile > Tagged, then removes the tag and the post leaves Tagged.
 */
test('Community: mention a follower, notify, Tagged tab, remove the tag', async ({ page: a, browser }) => {
  test.setTimeout(120_000)
  const A = testUser()
  const B = testUserB()
  const C = testUserC()
  const text = `Mention e2e ${Date.now().toString(36)}`

  for (const u of [A, B, C]) await rpcAs(u, 'social_enable', { p_consent_version: brand.legal.socialConsentVersion })
  await rpcAs(A, 'social_unblock', { p_user: B.id })
  await rpcAs(B, 'social_unblock', { p_user: A.id })
  await rpcAs(B, 'social_unfollow', { p_user: A.id })
  await rpcAs(B, 'social_follow', { p_user: A.id }) // A is private: pending
  await rpcAs(A, 'social_respond_follow', { p_follower: B.id, p_accept: true })

  // candidates (API): B is offered, the stranger C is not, whatever the audience
  type Cand = { user_id: string; username: string }
  for (const p_audience of ['followers', 'public']) {
    const forB = await rpcAs<Cand[]>(A, 'social_mention_candidates', { p_query: B.username, p_audience })
    expect(forB.map((r) => r.user_id)).toContain(B.id)
    const forC = await rpcAs<Cand[]>(A, 'social_mention_candidates', { p_query: C.username, p_audience })
    expect(forC.map((r) => r.user_id)).not.toContain(C.id)
    const recent = await rpcAs<Cand[]>(A, 'social_mention_candidates', { p_query: '', p_audience })
    expect(recent.map((r) => r.user_id)).not.toContain(C.id)
  }

  // A writes, types @ + the start of B's username and picks B from the suggestions
  await a.goto('/social')
  await a.getByRole('button', { name: 'Share' }).click()
  const composer = a.getByRole('dialog', { name: 'New post' })
  const field = composer.getByRole('textbox', { name: 'Text' })
  await field.fill(`${text} spotted by `)
  await field.pressSequentially(`@${B.username.slice(0, 5)}`)
  await composer.getByRole('option').filter({ hasText: `@${B.username}` }).click()
  await expect(field).toHaveValue(`${text} spotted by @${B.username} `)
  await expect(composer.getByRole('button', { name: `Remove tag @${B.username}` })).toBeVisible()
  await composer.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(composer).toBeHidden()
  const mine = a.getByRole('article').filter({ hasText: text })
  await expect(mine.getByRole('link', { name: `@${B.username}` })).toHaveAttribute('href', `/social/u/${B.id}`)

  // B: the mention notification opens the post, which links back to B
  const ctxB = await browser.newContext({ storageState: STATE_FILE_B })
  const b = await ctxB.newPage()
  await b.goto('/social/notifications')
  await b.getByRole('link', { name: /tagged you in a post/ }).first().click()
  await expect(b).toHaveURL(/\/social\/p\//)
  const post = b.getByRole('article').filter({ hasText: text })
  await expect(post.getByRole('link', { name: `@${B.username}` })).toHaveAttribute('href', `/social/u/${B.id}`)

  // B: Profile > Tagged lists it; B removes the tag from the post menu and it leaves Tagged
  await b.goto('/me?tab=tagged')
  await expect(b.getByRole('tab', { name: 'Tagged', selected: true })).toBeVisible()
  const tagged = b.getByRole('article').filter({ hasText: text })
  await expect(tagged).toBeVisible()
  await tagged.getByRole('button', { name: 'Post options' }).click()
  await b.getByRole('dialog', { name: 'Post options' }).getByRole('button', { name: 'Remove my tag' }).click()
  await b.getByRole('alertdialog').getByRole('button', { name: 'Remove tag' }).click()
  await expect(b.getByText(text)).toHaveCount(0)
  const left = await rpcAs<{ body: string }[]>(B, 'social_mentioned_posts', {})
  expect(left.some((p) => p.body?.startsWith(text))).toBe(false)
  // the post itself stays, now without the tag
  const feed = await rpcAs<{ body: string; mentions: unknown[] }[]>(B, 'social_feed', {})
  expect(feed.find((p) => p.body?.startsWith(text))?.mentions).toEqual([])

  await ctxB.close()
})
