import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { chromium, expect } from '@playwright/test'

const siteUrl = process.env.SITE_URL
const runId = process.env.GITHUB_RUN_ID

assert.ok(siteUrl, 'SITE_URL is required')
assert.match(runId ?? '', /^\d+$/, 'GITHUB_RUN_ID is required')

const users = {
  author: {
    email: process.env.E2E_SEAFARER_EMAIL,
    password: process.env.E2E_SEAFARER_PASSWORD,
    fullName: process.env.E2E_SEAFARER_NAME,
  },
  reposter: {
    email: process.env.E2E_SHORE_EMAIL,
    password: process.env.E2E_SHORE_PASSWORD,
    fullName: process.env.E2E_SHORE_NAME,
  },
  fallback: {
    email: process.env.E2E_ENTHUSIAST_EMAIL,
    password: process.env.E2E_ENTHUSIAST_PASSWORD,
    fullName: process.env.E2E_ENTHUSIAST_NAME,
  },
}

for (const user of Object.values(users)) {
  assert.match(user.email ?? '', /^sea-n-shore-e2e-[0-9]+-(seafarer|shore|enthusiast)@example\.com$/)
  assert.ok((user.password ?? '').length >= 12)
  assert.ok(user.fullName)
}

// A photo-sized avatar (160x160 PNG). A 1x1 image cannot stand in for a photo: picked from a
// srcset at 96w for a 44px slot, its density-corrected naturalWidth rounds down to 0, which
// the feed's photo component takes for an image that failed before hydration.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function gradientPng(size) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // truecolour RGB
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3)
    for (let x = 0; x < size; x++) {
      row[1 + x * 3] = 20 + Math.round((x / size) * 60)
      row[2 + x * 3] = 90 + Math.round((y / size) * 80)
      row[3 + x * 3] = 160
    }
    rows.push(row)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const avatarPng = gradientPng(160)

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
  // Note which photos the browser could not show (an <img> error makes a photo fall back to initials).
  await context.addInitScript(() => {
    window.__feedImageErrors = []
    document.addEventListener('error', (event) => {
      const target = event.target
      if (target && target.tagName === 'IMG') window.__feedImageErrors.push({ alt: target.alt, src: target.currentSrc || target.src })
    }, true)
    // And which profile photos were taken off the page, in what state.
    window.__feedRemovedPhotos = []
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          const images = node.nodeType === 1 ? (node.tagName === 'IMG' ? [node] : [...node.querySelectorAll('img')]) : []
          for (const img of images) {
            if (!/profile photo$/.test(img.alt)) continue
            window.__feedRemovedPhotos.push({ alt: img.alt, complete: img.complete, naturalWidth: img.naturalWidth, src: img.currentSrc || img.src })
          }
        }
      }
    }).observe(document, { childList: true, subtree: true })
  })
  const page = await context.newPage()
  // Record image requests that fail, so a photo that falls back to initials says why. Only the
  // status and the storage path are kept: the signed part of a media link is never printed.
  page.on('requestfailed', (request) => {
    if (request.resourceType() !== 'image') return
    failedImageResponses.push('failed(' + (request.failure()?.errorText ?? 'unknown') + ') ' + describeImageUrl(request.url()))
  })
  page.on('response', (response) => {
    if (response.request().resourceType() !== 'image') return
    const entry = response.status() + ' ' + (response.headers()['content-type'] ?? '-') + ' ' + (response.headers()['content-length'] ?? '?') + 'B ' + describeImageUrl(response.url())
    if (response.status() >= 400) failedImageResponses.push(entry)
    else if (response.url().includes('/_next/image') || response.url().includes('/api/media/image/')) recentImageResponses.push(entry)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().replace(/%3F[^&"\s,]*/gi, '%3F<query>').replace(/\?[^"\s,]*/g, '?<query>').slice(0, 200))
  })
  await page.goto(siteUrl + '/auth/sign-in', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/'), { timeout: 20_000 })
  return { context, page }
}

const failedImageResponses = []
const recentImageResponses = []
const consoleErrors = []

function describeImageUrl(raw) {
  try {
    const url = new URL(raw)
    const inner = url.pathname === '/_next/image' ? new URL(url.searchParams.get('url') ?? '', url.origin) : url
    const via = url.pathname === '/_next/image' ? '/_next/image(w=' + url.searchParams.get('w') + ') -> ' : ''
    return via + inner.pathname.replace(/\/[A-Za-z0-9_-]{20,}$/, '/<signature>')
  } catch {
    return 'unparseable image URL'
  }
}

// Post avatars are labelled "<name>'s profile photo", the Home profile card "<name> profile photo".
function profilePhotoName(fullName) {
  return new RegExp('^' + fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "(?:'s)? profile photo$")
}

async function uploadAvatar(page, user) {
  await page.goto(siteUrl + '/profile', { waitUntil: 'domcontentloaded' })
  const addButton = page.getByRole('button', { name: 'Add profile photo' })
  await expect(addButton).toBeVisible()
  const form = addButton.locator('xpath=ancestor::form')
  const control = form.locator('xpath=..')
  const alert = control.getByRole('alert').first()

  const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 20_000 })
  await addButton.click()
  const fileChooser = await fileChooserPromise

  const uploadResponsePromise = page.waitForResponse(
    (response) => {
      if (response.request().method() !== 'POST') return false
      return new URL(response.url()).pathname === '/profile'
    },
    { timeout: 30_000 },
  )
  await fileChooser.setFiles({
    name: 'avatar-' + runId + '.png',
    mimeType: 'image/png',
    buffer: avatarPng,
  })
  // Picking a photo opens the crop dialog (9d7be1dd); Save crops in the browser, then the upload posts.
  const cropDialog = page.getByRole('dialog')
  await expect(cropDialog).toBeVisible({ timeout: 20_000 })
  await cropDialog.getByRole('button', { name: 'Save', exact: true }).click()

  const uploadResponse = await uploadResponsePromise
  assert.ok(uploadResponse.ok(), 'Profile avatar upload request returned HTTP ' + uploadResponse.status())

  const changeButton = page.getByRole('button', { name: 'Change profile photo' })
  await expect.poll(async () => {
    if ((await alert.count()) > 0 && await alert.isVisible().catch(() => false)) return 'error'
    if (await changeButton.isVisible().catch(() => false)) return 'success'
    return 'pending'
  }, { timeout: 20_000 }).not.toBe('pending')

  if ((await alert.count()) > 0 && await alert.isVisible().catch(() => false)) {
    const message = (await alert.innerText()).trim()
    throw new Error('Profile avatar upload failed: ' + (message || 'Unknown upload error'))
  }

  await expect(changeButton).toBeVisible({ timeout: 20_000 })
  const avatar = page.getByRole('img', { name: profilePhotoName(user.fullName) }).first()
  await expect(avatar).toBeVisible({ timeout: 20_000 })
  // The first request for a new photo waits for the image optimizer; give it time to decode.
  await expect.poll(() => avatar.evaluate((img) => img.complete && img.naturalWidth > 0), { timeout: 20_000 }).toBe(true).catch(() => {})
  const state = await avatar.evaluate((img) => ({
    src: img.currentSrc || img.src,
    complete: img.complete,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
  }))
  if (!(state.complete && state.naturalWidth > 0 && state.naturalHeight > 0)) {
    const response = await page.context().request.get(new URL(state.src, siteUrl).toString()).catch(() => null)
    const path = new URL(state.src, siteUrl).pathname
    throw new Error('Uploaded profile avatar must decode (' + path + ' returned HTTP ' + (response ? response.status() : 'no response') + ')')
  }
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

async function verifyImage(context, image, label, card, fullName) {
  // Avatars below the fold load lazily, a new photo's first request waits for the optimizer, and
  // the feed may re-render the card meanwhile: re-find the image and retry until it has decoded.
  let state = null
  await expect(async () => {
    await image.scrollIntoViewIfNeeded({ timeout: 5_000 })
    state = await image.evaluate((img) => ({
      src: img.currentSrc || img.src,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    }), undefined, { timeout: 5_000 })
    expect(state.complete && state.naturalWidth > 0).toBe(true)
  }).toPass({ timeout: 30_000 }).catch(async (error) => {
    // Say what the card shows instead (the signed query of a media link is dropped).
    const html = card
      ? await card.locator('header').first().evaluate((element) => element.outerHTML, undefined, { timeout: 2_000 }).catch(() => 'card header not found')
      : 'no card given'
    await image.page().screenshot({ path: '/tmp/sea-n-shore-feed-avatar-e2e.png', fullPage: false }).catch(() => {})
    const redacted = String(html)
      .replace(/%3F[^&"\s,]*/gi, '%3F<query>')
      .replace(/(\/api\/media\/image\/[^"?\s,]*)\?[^"\s,]*/g, '$1?<query>')
    console.error('FEED_AVATAR_SLOT_HTML=' + redacted.slice(0, 1500))
    const imageErrors = await image.page().evaluate(() => window.__feedImageErrors ?? []).catch(() => [])
    for (const entry of imageErrors.slice(-8)) console.error('FEED_AVATAR_IMG_ERROR=' + entry.alt + ' <- ' + describeImageUrl(entry.src))
    const removed = await image.page().evaluate(() => window.__feedRemovedPhotos ?? []).catch(() => [])
    for (const entry of removed.slice(-8)) console.error('FEED_AVATAR_REMOVED_PHOTO=' + entry.alt + ' complete=' + entry.complete + ' naturalWidth=' + entry.naturalWidth + ' <- ' + describeImageUrl(entry.src))
    // Did the server send the photo in this card? Read the card's header in the server-rendered Home feed.
    const labelledBy = card ? await card.getAttribute('aria-labelledby', { timeout: 2_000 }).catch(() => null) : null
    if (labelledBy) {
      const homeHtml = await context.request.get(siteUrl + '/home').then((response) => response.text()).catch(() => '')
      const start = homeHtml.indexOf('aria-labelledby="' + labelledBy + '"')
      const header = start >= 0 ? homeHtml.slice(start, homeHtml.indexOf('</header>', start)) : ''
      console.error('FEED_AVATAR_SERVER_CARD_FOUND=' + (start >= 0) + ' server_header_has_img=' + header.includes('<img'))
      if (fullName) console.error('FEED_AVATAR_SERVER_HEADER_HAS_PHOTO=' + header.includes(fullName + '&#x27;s profile photo'))
    }
    throw error
  })
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
  // The action reads "Repost" on posts that can be reposted ("Share" only when reposting is not allowed).
  await sourceArticle.getByRole('button', { name: /^(Repost|Share)$/ }).click()
  // The share menu is portaled to the page body (it never gets clipped by the card).
  await page.getByRole('menuitem', { name: 'Repost to feed' }).click()
  await page.waitForTimeout(800)
  await page.reload({ waitUntil: 'domcontentloaded' })

  const repost = page.locator('article')
    .filter({ hasText: users.reposter.fullName })
    .filter({ hasText: 'reposted' })
    .filter({ hasText: postText })
    .first()
  await expect(repost).toBeVisible({ timeout: 20_000 })

  const repostAvatar = repost.locator('header').getByRole('img', { name: profilePhotoName(users.reposter.fullName) }).first()
  const sourceRegion = repost.getByRole('region', { name: 'Original post by ' + users.author.fullName })
  const sourceAvatar = sourceRegion.getByRole('img', { name: profilePhotoName(users.author.fullName) }).first()

  const repostSrc = await verifyImage(context, repostAvatar, 'Reposting user avatar', repost, users.reposter.fullName)
  const sourceSrc = await verifyImage(context, sourceAvatar, 'Original post author avatar', sourceRegion, users.author.fullName)

  await repost.screenshot({ path: '/tmp/sea-n-shore-feed-avatar-e2e.png' })

  console.log('FEED_AVATAR_REPOSTER_URL=' + repostSrc.split('?')[0])
  console.log('FEED_AVATAR_SOURCE_URL=' + sourceSrc.split('?')[0])
  console.log('FEED_AVATAR_REPOSTER_RENDER_VERIFIED=true')
  console.log('FEED_AVATAR_SOURCE_RENDER_VERIFIED=true')
}

async function verifyFallbackInitials(page) {
  const article = await createPost(page, fallbackPostText)
  const header = article.locator('header').first()
  const image = header.getByRole('img', { name: profilePhotoName(users.fallback.fullName) })
  await expect(image).toHaveCount(0)
  // The avatar slot is the link to the author's profile; with no photo it shows the initials.
  const avatarSlot = header.getByRole('link', { name: 'View ' + users.fallback.fullName + "'s profile" }).first()
  await expect(avatarSlot).toHaveText(initials(users.fallback.fullName))
  console.log('FEED_AVATAR_FALLBACK_INITIALS_VERIFIED=true')
}

async function deleteOwnPost(page, text, repostedBy) {
  await page.goto(siteUrl + '/home', { waitUntil: 'domcontentloaded' })
  // The reposter deletes only their own repost card, never the author's post.
  let article = page.locator('article').filter({ hasText: text })
  if (repostedBy) article = article.filter({ hasText: repostedBy }).filter({ hasText: 'reposted' })
  article = article.first()
  if ((await article.count()) === 0) return
  // Delete sits in the post's "Post options" (…) menu and asks for confirmation in a dialog.
  await article.getByRole('button', { name: 'Post options' }).click()
  await page.getByRole('menuitem', { name: 'Delete post' }).click()
  await page.getByRole('alertdialog', { name: 'Delete this post?' }).getByRole('button', { name: 'Delete post' }).click()
  await expect(article).toBeHidden({ timeout: 20_000 })
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
  if (reposterPage) await deleteOwnPost(reposterPage, postText, users.reposter.fullName).catch((error) => cleanupErrors.push('repost:' + error.message))
  if (authorPage) await deleteOwnPost(authorPage, postText).catch((error) => cleanupErrors.push('source:' + error.message))
  if (fallbackPage) await deleteOwnPost(fallbackPage, fallbackPostText).catch((error) => cleanupErrors.push('fallback:' + error.message))
  if (reposterPage) await removeAvatar(reposterPage).catch((error) => cleanupErrors.push('reposter-avatar:' + error.message))
  if (authorPage) await removeAvatar(authorPage).catch((error) => cleanupErrors.push('author-avatar:' + error.message))
  for (const context of contexts) await context.close().catch(() => {})
  await browser.close()
}

for (const failure of failedImageResponses) console.error('FEED_AVATAR_FAILED_IMAGE_RESPONSE=' + failure)
for (const entry of recentImageResponses.slice(-12)) console.error('FEED_AVATAR_IMAGE_RESPONSE=' + entry)
for (const entry of consoleErrors.slice(-8)) console.error('FEED_AVATAR_CONSOLE_ERROR=' + entry)
if (primaryError && cleanupErrors.length) console.error('Feed avatar E2E cleanup also failed: ' + cleanupErrors.join(' | '))
if (primaryError) throw primaryError
if (cleanupErrors.length) throw new Error('Feed avatar E2E cleanup failed: ' + cleanupErrors.join(' | '))
