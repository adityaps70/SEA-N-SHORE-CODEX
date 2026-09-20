import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

const siteUrl = process.env.SITE_URL
const runId = process.env.GITHUB_RUN_ID

assert.ok(siteUrl, 'SITE_URL is required')
assert.match(runId ?? '', /^\d+$/, 'GITHUB_RUN_ID is required')

const users = {
  author: {
    email: process.env.E2E_PROFESSIONAL_EMAIL,
    password: process.env.E2E_PROFESSIONAL_PASSWORD,
    fullName: process.env.E2E_PROFESSIONAL_NAME,
  },
  reposter: {
    email: process.env.E2E_CUSTOM_EMAIL,
    password: process.env.E2E_CUSTOM_PASSWORD,
    fullName: process.env.E2E_CUSTOM_NAME,
  },
  fallback: {
    email: process.env.E2E_ORGANISATION_EMAIL,
    password: process.env.E2E_ORGANISATION_PASSWORD,
    fullName: process.env.E2E_ORGANISATION_NAME,
  },
}

for (const user of Object.values(users)) {
  assert.match(user.email ?? '', /^sea-n-shore-e2e-[0-9]+-(professional|custom|organisation)@example\.com$/)
  assert.ok((user.password ?? '').length >= 12)
  assert.ok(user.fullName)
}

const avatarPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlYwQAAAABJRU5ErkJggg==',
  'base64',
)

const postText = 'Feed avatar hydration staging proof ' + runId
const fallbackPostText = 'Feed avatar fallback staging proof ' + runId
const browser = await chromium.launch()
const contexts = []

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

async function newSignedInPage(user) {
  const context = await browser.newContext()
  contexts.push(context)
  const page = await context.newPage()
  await page.goto(siteUrl + '/auth/sign-in', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/'), { timeout: 20_000 })
  return { context, page }
}

async function uploadAvatar(page, user) {
  await page.goto(siteUrl + '/profile', { waitUntil: 'domcontentloaded' })
  const addButton = page.getByRole('button', { name: 'Add profile photo' })
  await expect(addButton).toBeVisible()
  const form = addButton.locator('xpath=ancestor::form')
  const input = form.locator('input[name="image"]')
  const uploadResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().startsWith(siteUrl + '/profile'),
    { timeout: 60_000 },
  )
  await input.setInputFiles({
    name: 'avatar-' + runId + '.png',
    mimeType: 'image/png',
    buffer: avatarPng,
  })
  const response = await uploadResponsePromise
  console.log('profile upload action status=' + response.status())
  const responseBody = await response.text()
  console.log('profile upload action response=' + responseBody.slice(0, 2000).replace(/\s+/g, ' '))
  assert.ok(response.ok(), 'Profile upload action must return a successful HTTP status')

  const control = form.locator('xpath=..')
  const alert = control.getByRole('alert')
  if ((await alert.count()) > 0 && await alert.first().isVisible().catch(() => false)) {
    const message = (await alert.first().innerText()).trim()
    if (message) throw new Error('Profile avatar upload failed: ' + message)
  }

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Change profile photo' })).toBeVisible({ timeout: 20_000 })
  const avatar = page.getByRole('img', { name: user.fullName + "'s profile photo" }).first()
  await expect(avatar).toBeVisible({ timeout: 20_000 })
  const state = await avatar.evaluate((img) => ({
    src: img.currentSrc || img.src,
    complete: img.complete,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
  }))
  assert.ok(state.complete && state.naturalWidth > 0 && state.naturalHeight > 0, 'Uploaded profile avatar must decode')
  assert.ok(state.src.includes('/profiles/') || state.src.includes('profiles%2F') || state.src.includes('profiles/'), 'Uploaded profile avatar should resolve from profile media storage')
}

async function createPost(page, text) {
  await page.goto(siteUrl + '/home', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Start a post' })).toBeVisible()
  await page.getByRole('button', { name: 'Start a post' }).click()
  await expect(page.getByRole('heading', { name: 'Create a post' })).toBeVisible()
  await page.locator('#feed-post-body').fill(text)
  await page.getByRole('button', { name: 'Post Update' }).click()
  await expect(page.getByRole('heading', { name: 'Create a post' })).toBeHidden({ timeout: 20_000 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const article = page.locator('article').filter({ hasText: text }).first()
  await expect(article).toBeVisible({ timeout: 20_000 })
  return article
}

async function verifyImage(context, image, label) {
  await expect(image).toBeVisible({ timeout: 20_000 })
  const state = await image.evaluate((img) => ({
    src: img.currentSrc || img.src,
    complete: img.complete,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
  }))
  assert.ok(state.complete, label + ' did not finish loading')
  assert.ok(state.naturalWidth > 0 && state.naturalHeight > 0, label + ' did not decode')
  assert.ok(!state.src.includes('/api/feed-media/'), label + ' incorrectly used /api/feed-media/')
  const response = await context.request.get(state.src)
  assert.ok(response.status() >= 200 && response.status() < 400, label + ' returned HTTP ' + response.status())
  return state.src
}

async function repostAndVerify(page, context) {
  await page.goto(siteUrl + '/home', { waitUntil: 'domcontentloaded' })
  const sourceArticle = page.locator('article').filter({ hasText: postText }).first()
  await expect(sourceArticle).toBeVisible({ timeout: 20_000 })
  await sourceArticle.getByRole('button', { name: 'Share' }).click()
  await sourceArticle.getByRole('menuitem', { name: 'Repost to feed' }).click()
  await page.waitForTimeout(800)
  await page.reload({ waitUntil: 'domcontentloaded' })

  const repost = page.locator('article')
    .filter({ hasText: users.reposter.fullName })
    .filter({ hasText: 'reposted' })
    .filter({ hasText: postText })
    .first()
  await expect(repost).toBeVisible({ timeout: 20_000 })

  const repostAvatar = repost.locator('header').getByRole('img', { name: users.reposter.fullName + "'s profile photo" }).first()
  const sourceRegion = repost.getByRole('region', { name: 'Original post by ' + users.author.fullName })
  const sourceAvatar = sourceRegion.getByRole('img', { name: users.author.fullName + "'s profile photo" }).first()

  const repostSrc = await verifyImage(context, repostAvatar, 'Reposting user avatar')
  const sourceSrc = await verifyImage(context, sourceAvatar, 'Original post author avatar')

  await repost.screenshot({ path: '/tmp/sea-n-shore-feed-avatar-e2e.png' })

  console.log('FEED_AVATAR_REPOSTER_URL=' + repostSrc.split('?')[0])
  console.log('FEED_AVATAR_SOURCE_URL=' + sourceSrc.split('?')[0])
  console.log('FEED_AVATAR_REPOSTER_RENDER_VERIFIED=true')
  console.log('FEED_AVATAR_SOURCE_RENDER_VERIFIED=true')
}

async function verifyFallbackInitials(page) {
  const article = await createPost(page, fallbackPostText)
  const header = article.locator('header').first()
  const image = header.getByRole('img', { name: users.fallback.fullName + "'s profile photo" })
  await expect(image).toHaveCount(0)
  const avatarSlot = header.locator(':scope > div').first()
  await expect(avatarSlot).toHaveText(initials(users.fallback.fullName))
  console.log('FEED_AVATAR_FALLBACK_INITIALS_VERIFIED=true')
}

async function deleteOwnPost(page, text) {
  await page.goto(siteUrl + '/home', { waitUntil: 'domcontentloaded' })
  const article = page.locator('article').filter({ hasText: text }).first()
  if ((await article.count()) === 0) return
  page.once('dialog', (dialog) => dialog.accept())
  await article.getByRole('button', { name: 'Delete post' }).click()
  await expect(article).toBeHidden({ timeout: 20_000 }).catch(() => {})
}

async function removeAvatar(page) {
  await page.goto(siteUrl + '/profile', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  const removeButton = page.getByRole('button', { name: 'Remove profile photo' })
  if ((await removeButton.count()) === 0) return
  await removeButton.click()
  await expect(page.getByRole('button', { name: 'Add profile photo' })).toBeVisible({ timeout: 20_000 })
}

let authorPage
let reposterPage
let fallbackPage
let primaryError
const cleanupErrors = []

try {
  const authorSession = await newSignedInPage(users.author)
  authorPage = authorSession.page
  const reposterSession = await newSignedInPage(users.reposter)
  reposterPage = reposterSession.page
  const fallbackSession = await newSignedInPage(users.fallback)
  fallbackPage = fallbackSession.page

  await uploadAvatar(authorPage, users.author)
  await uploadAvatar(reposterPage, users.reposter)

  await createPost(authorPage, postText)
  await repostAndVerify(reposterPage, reposterSession.context)
  await verifyFallbackInitials(fallbackPage)

  console.log('FEED_AVATAR_STAGING_E2E_VERIFIED=true')
} catch (error) {
  primaryError = error
} finally {
  if (reposterPage) await deleteOwnPost(reposterPage, postText).catch((error) => cleanupErrors.push('repost:' + error.message))
  if (authorPage) await deleteOwnPost(authorPage, postText).catch((error) => cleanupErrors.push('source:' + error.message))
  if (fallbackPage) await deleteOwnPost(fallbackPage, fallbackPostText).catch((error) => cleanupErrors.push('fallback:' + error.message))
  if (reposterPage) await removeAvatar(reposterPage).catch((error) => cleanupErrors.push('reposter-avatar:' + error.message))
  if (authorPage) await removeAvatar(authorPage).catch((error) => cleanupErrors.push('author-avatar:' + error.message))
  for (const context of contexts) await context.close().catch(() => {})
  await browser.close()
}

if (primaryError) throw primaryError
if (cleanupErrors.length) throw new Error('Feed avatar E2E cleanup failed: ' + cleanupErrors.join(' | '))
