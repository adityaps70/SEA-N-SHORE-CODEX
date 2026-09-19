import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

const siteUrl = process.env.SITE_URL
const phase = process.env.E2E_PHASE
const runId = process.env.GITHUB_RUN_ID
const conversationId = process.env.E2E_CONVERSATION_ID
const messageBody = process.env.E2E_MESSAGE_BODY
const injectedBody = process.env.E2E_INJECTED_BODY
const messagingOnly = process.env.E2E_MESSAGING_ONLY === 'true'
const socialPostBody = process.env.E2E_SOCIAL_POST_BODY
const socialCommentBody = process.env.E2E_SOCIAL_COMMENT_BODY
const users = {
  sender: { email: process.env.E2E_SENDER_EMAIL, password: process.env.E2E_SENDER_PASSWORD, fullName: process.env.E2E_SENDER_NAME },
  recipient: { email: process.env.E2E_RECIPIENT_EMAIL, password: process.env.E2E_RECIPIENT_PASSWORD, fullName: process.env.E2E_RECIPIENT_NAME },
}

assert.ok(siteUrl)
assert.ok(runId)
assert.ok(['signup', 'onboarding', 'connect-probe', 'social', 'realtime'].includes(phase))
for (const [key, user] of Object.entries(users)) {
  assert.match(user.email ?? '', new RegExp(`^sea-n-shore-realtime-e2e-[0-9]+-${key}@example\\.com$`))
  assert.ok((user.password ?? '').length >= 12)
  assert.ok(user.fullName)
}
if (phase === 'realtime') {
  assert.match(conversationId ?? '', /^[0-9a-f-]{36}$/)
  assert.ok(messageBody)
  assert.ok(injectedBody)
}
if (phase === 'social') {
  assert.ok(socialPostBody)
  assert.ok(socialCommentBody)
}

const browser = await chromium.launch()

async function signUp(user) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${siteUrl}/auth/sign-up`, { waitUntil: 'networkidle' })
  await page.getByLabel('Full name').fill(user.fullName)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL((url) => url.pathname === '/auth/sign-up' && url.searchParams.get('confirm') === '1', { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible()
  await context.close()
}

async function signInForOnboarding(page, user) {
  await page.goto(`${siteUrl}/auth/sign-in`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/onboarding', { timeout: 20_000 })
}

async function completeProfessional(user, suffix) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInForOnboarding(page, user)
  await page.getByRole('button', { name: /Professional Build your individual maritime identity/ }).click()
  await page.getByLabel('Search professional identities').fill('Master')
  await page.getByRole('button', { name: 'Master — Sea-going · Deck' }).click()
  const username = `rt-${suffix}-${runId}`
  assert.ok(username.length <= 30, `Realtime E2E username is too long: ${username}`)
  await page.locator('input[name="slug"]').fill(username)
  await expect(page.getByText('Username is available.', { exact: true })).toBeVisible({ timeout: 10_000 })
  await page.getByLabel('Location').fill('Mumbai')
  await page.getByLabel('Current organisation').fill(`Sea N Shore Realtime E2E ${suffix}`)
  const completeButton = page.getByRole('button', { name: 'Complete profile' })
  await expect(completeButton).toBeEnabled()
  await completeButton.click()
  await page.waitForURL((url) => url.pathname === '/home', { timeout: 20_000 })
  await context.close()
}

async function signInCompleted(page, user) {
  await page.goto(`${siteUrl}/auth/sign-in`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/home', { timeout: 20_000 })
}

async function openProbeSocket(page, key) {
  return await page.evaluate(async ({ key }) => {
    const response = await fetch('/api/realtime/ticket', { method: 'POST', cache: 'no-store' })
    if (!response.ok) throw new Error(`ticket_http_${response.status}`)
    const payload = await response.json()
    const url = new URL(payload.webSocketUrl)
    url.searchParams.set('ticket', payload.ticket)
    const socket = new WebSocket(url.toString())
    globalThis[`__realtime_${key}_signals`] = []
    globalThis[`__realtime_${key}_socket`] = socket
    socket.onmessage = (event) => {
      try { globalThis[`__realtime_${key}_signals`].push(JSON.parse(event.data)) } catch {}
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('websocket_open_timeout')), 15_000)
      socket.onopen = () => { clearTimeout(timer); resolve() }
      socket.onerror = () => { clearTimeout(timer); reject(new Error('websocket_open_error')) }
    })
    return { webSocketUrl: payload.webSocketUrl, expiresAt: payload.expiresAt }
  }, { key })
}

async function closeProbeSocket(page, key) {
  await page.evaluate((key) => {
    const socket = globalThis[`__realtime_${key}_socket`]
    if (socket && socket.readyState < 2) socket.close(1000, 'e2e-complete')
  }, key)
}

async function waitForSignal(page, key, eventType, minimumCount = 1) {
  await page.waitForFunction(({ key, eventType, minimumCount }) => {
    const signals = globalThis[`__realtime_${key}_signals`] ?? []
    return signals.filter((signal) => signal?.eventType === eventType).length >= minimumCount
  }, { key, eventType, minimumCount }, { timeout: 30_000 })
  return await page.evaluate(({ key, eventType }) => {
    const signals = globalThis[`__realtime_${key}_signals`] ?? []
    return signals.filter((signal) => signal?.eventType === eventType).at(-1)
  }, { key, eventType })
}

function assertSocialSignalMetadataOnly(signal, eventType, scope, forbiddenText = '') {
  assert.ok(signal)
  assert.equal(signal.eventType, eventType)
  assert.equal(signal.scope, scope)
  assert.equal(signal.schemaVersion, 1)
  assert.match(signal.eventId ?? '', /^[0-9a-f-]{36}$/)
  assert.ok(Number.isFinite(Date.parse(signal.occurredAt ?? '')))
  assert.equal('aggregateId' in signal, false)
  assert.equal('payload' in signal, false)
  assert.deepEqual(Object.keys(signal).sort(), ['eventId', 'eventType', 'occurredAt', 'schemaVersion', 'scope'].sort())
  if (forbiddenText) assert.equal(JSON.stringify(signal).includes(forbiddenText), false)
}

async function connectProbeJourney() {
  const senderContext = await browser.newContext()
  const senderPage = await senderContext.newPage()

  try {
    await signInCompleted(senderPage, users.sender)
    let result = 'opened'
    try {
      const ticket = await openProbeSocket(senderPage, 'connect_probe')
      assert.match(ticket.webSocketUrl, /^wss:/)
      await closeProbeSocket(senderPage, 'connect_probe')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error'
      if (message.includes('websocket_open_timeout')) {
        result = 'websocket_open_timeout'
      } else if (message.includes('websocket_open_error')) {
        result = 'websocket_open_error'
      } else {
        throw error
      }
    }
    console.log(`REALTIME_E2E_CONNECT_PROBE_RESULT=${result}`)
  } finally {
    await senderContext.close()
  }
}

async function socialJourney() {
  const senderContext = await browser.newContext()
  const recipientContext = await browser.newContext()
  const senderPage = await senderContext.newPage()
  const recipientPage = await recipientContext.newPage()

  try {
    await signInCompleted(senderPage, users.sender)
    await signInCompleted(recipientPage, users.recipient)
    await senderPage.goto(`${siteUrl}/home`, { waitUntil: 'domcontentloaded' })
    await recipientPage.goto(`${siteUrl}/home`, { waitUntil: 'domcontentloaded' })

    const senderTicket = await openProbeSocket(senderPage, 'social_sender')
    const recipientTicket = await openProbeSocket(recipientPage, 'social_recipient')
    assert.match(senderTicket.webSocketUrl, /^wss:/)
    assert.equal(senderTicket.webSocketUrl, recipientTicket.webSocketUrl)

    await senderPage.getByRole('button', { name: 'Start a post' }).click()
    await senderPage.getByLabel('Post to Sea N Shore').fill(socialPostBody)
    await senderPage.getByRole('button', { name: 'Post', exact: true }).click()
    await expect(senderPage.getByText(socialPostBody, { exact: true })).toBeVisible({ timeout: 30_000 })

    const createdSignal = await waitForSignal(recipientPage, 'social_recipient', 'feed.post_created')
    assertSocialSignalMetadataOnly(createdSignal, 'feed.post_created', 'feed', socialPostBody)
    await expect(recipientPage.getByText(socialPostBody, { exact: true })).toBeVisible({ timeout: 30_000 })
    console.log('REALTIME_E2E_FEED_POST_CREATED_VERIFIED=true')

    const recipientPost = recipientPage.locator('article').filter({ hasText: socialPostBody }).first()
    await recipientPost.getByRole('button', { name: 'Like', exact: true }).click()
    const reactionAdded = await waitForSignal(senderPage, 'social_sender', 'feed.post_reaction_changed', 1)
    assertSocialSignalMetadataOnly(reactionAdded, 'feed.post_reaction_changed', 'feed', socialPostBody)
    const senderPost = senderPage.locator('article').filter({ hasText: socialPostBody }).first()
    await expect(senderPost.getByRole('button', { name: 'View 1 reaction' })).toBeVisible({ timeout: 30_000 })

    await recipientPost.getByRole('button', { name: 'Like', exact: true }).click()
    const reactionRemoved = await waitForSignal(senderPage, 'social_sender', 'feed.post_reaction_changed', 2)
    assertSocialSignalMetadataOnly(reactionRemoved, 'feed.post_reaction_changed', 'feed', socialPostBody)
    await expect(senderPost.getByRole('button', { name: 'View 1 reaction' })).toHaveCount(0, { timeout: 30_000 })
    console.log('REALTIME_E2E_FEED_REACTION_TOGGLE_VERIFIED=true')

    await recipientPost.getByRole('button', { name: 'Comment', exact: true }).click()
    await recipientPost.getByLabel('Add a comment').fill(socialCommentBody)
    await recipientPost.getByRole('button', { name: 'Comment', exact: true }).last().click()
    await expect(recipientPost.getByText(socialCommentBody, { exact: true })).toBeVisible({ timeout: 20_000 })
    const commentSignal = await waitForSignal(senderPage, 'social_sender', 'feed.post_comments_changed')
    assertSocialSignalMetadataOnly(commentSignal, 'feed.post_comments_changed', 'feed', socialCommentBody)
    await expect(senderPost.getByText(socialCommentBody, { exact: true })).toBeVisible({ timeout: 30_000 })
    console.log('REALTIME_E2E_FEED_COMMENT_VERIFIED=true')

    await recipientPost.getByRole('button', { name: 'Share', exact: true }).click()
    await recipientPost.getByRole('menuitem', { name: 'Repost to feed' }).click()
    const repostSignal = await waitForSignal(senderPage, 'social_sender', 'feed.post_reposted')
    assertSocialSignalMetadataOnly(repostSignal, 'feed.post_reposted', 'feed', socialPostBody)
    await senderPage.waitForFunction((body) => {
      return Array.from(document.querySelectorAll('article')).filter((article) => article.textContent?.includes(body)).length >= 2
    }, socialPostBody, { timeout: 30_000 })
    console.log('REALTIME_E2E_FEED_REPOST_VERIFIED=true')

    await closeProbeSocket(senderPage, 'social_sender')
    await closeProbeSocket(recipientPage, 'social_recipient')

    await senderPage.goto(`${siteUrl}/people/rt-recipient-${runId}`, { waitUntil: 'domcontentloaded' })
    await openProbeSocket(senderPage, 'social_sender_connection')
    await senderPage.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(senderPage.getByText('Pending', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(senderPage.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled({ timeout: 20_000 })

    await recipientPage.goto(`${siteUrl}/people/rt-sender-${runId}`, { waitUntil: 'domcontentloaded' })
    await openProbeSocket(recipientPage, 'social_recipient_connection')
    await recipientPage.getByRole('button', { name: 'Accept', exact: true }).click()
    const senderConnectionSignal = await waitForSignal(senderPage, 'social_sender_connection', 'connection.accepted')
    const recipientConnectionSignal = await waitForSignal(recipientPage, 'social_recipient_connection', 'connection.accepted')
    assertSocialSignalMetadataOnly(senderConnectionSignal, 'connection.accepted', 'network')
    assertSocialSignalMetadataOnly(recipientConnectionSignal, 'connection.accepted', 'network')
    await expect(senderPage.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(recipientPage.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 })
    console.log('REALTIME_E2E_CONNECTION_ACCEPTED_VERIFIED=true')

    await closeProbeSocket(senderPage, 'social_sender_connection')
    await closeProbeSocket(recipientPage, 'social_recipient_connection')
    await recipientPage.goto(`${siteUrl}/home`, { waitUntil: 'domcontentloaded' })
    await expect(recipientPage.getByText(socialPostBody, { exact: true }).first()).toBeVisible({ timeout: 20_000 })
    await expect(recipientPage.getByText(socialCommentBody, { exact: true }).first()).toBeVisible({ timeout: 20_000 })
    await expect(recipientPage.getByText('reposted', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
    console.log('REALTIME_E2E_SOCIAL_RECONNECT_CONVERGENCE_VERIFIED=true')
    console.log('REALTIME_E2E_SOCIAL_BROWSER_VERIFIED=true')
  } finally {
    await senderContext.close()
    await recipientContext.close()
  }
}

async function realtimeJourney() {
  const senderContext = await browser.newContext()
  const recipientContext = await browser.newContext()
  const anonymousContext = await browser.newContext()
  const senderPage = await senderContext.newPage()
  const recipientPage = await recipientContext.newPage()
  const anonymousPage = await anonymousContext.newPage()

  try {
    const unauthenticated = await anonymousPage.request.post(`${siteUrl}/api/realtime/ticket`)
    assert.equal(unauthenticated.status(), 401)
    console.log('REALTIME_E2E_UNAUTHENTICATED_TICKET_REJECTED=true')

    await signInCompleted(senderPage, users.sender)
    await signInCompleted(recipientPage, users.recipient)
    await senderPage.goto(`${siteUrl}/messages/${conversationId}`, { waitUntil: 'domcontentloaded' })
    await recipientPage.goto(`${siteUrl}/messages`, { waitUntil: 'domcontentloaded' })
    await expect(senderPage.getByLabel('Write a message')).toBeVisible()
    await expect(recipientPage.getByRole('heading', { name: 'Messages' })).toBeVisible()

    const senderTicket = await openProbeSocket(senderPage, 'sender')
    const recipientTicket = await openProbeSocket(recipientPage, 'recipient')
    assert.match(senderTicket.webSocketUrl, /^wss:/)
    assert.equal(senderTicket.webSocketUrl, recipientTicket.webSocketUrl)

    const malformedRejected = await anonymousPage.evaluate(async (webSocketUrl) => {
      const url = new URL(webSocketUrl)
      url.searchParams.set('ticket', 'malformed-ticket')
      return await new Promise((resolve) => {
        const socket = new WebSocket(url.toString())
        const timer = setTimeout(() => { try { socket.close() } catch {}; resolve(false) }, 10_000)
        socket.onopen = () => { clearTimeout(timer); socket.close(); resolve(false) }
        socket.onerror = () => {}
        socket.onclose = () => { clearTimeout(timer); resolve(true) }
      })
    }, senderTicket.webSocketUrl)
    assert.equal(malformedRejected, true)
    console.log('REALTIME_E2E_MALFORMED_TICKET_REJECTED=true')

    await senderPage.getByLabel('Write a message').fill(messageBody)
    await senderPage.getByRole('button', { name: 'Send message' }).click()
    await expect(senderPage.getByText(messageBody, { exact: true })).toBeVisible({ timeout: 20_000 })

    await recipientPage.waitForFunction(({ conversationId }) => {
      const signals = globalThis.__realtime_recipient_signals ?? []
      return signals.some((signal) => signal?.eventType === 'message.created' && signal?.payload?.conversationId === conversationId)
    }, { conversationId }, { timeout: 30_000 })
    const messageSignal = await recipientPage.evaluate(({ conversationId }) => {
      return (globalThis.__realtime_recipient_signals ?? []).find((signal) => signal?.eventType === 'message.created' && signal?.payload?.conversationId === conversationId)
    }, { conversationId })
    assert.ok(messageSignal)
    assert.equal('body' in (messageSignal.payload ?? {}), false)
    assert.equal(JSON.stringify(messageSignal).includes(messageBody), false)
    console.log('REALTIME_E2E_MESSAGE_CREATED_SIGNAL_VERIFIED=true')

    await recipientPage.bringToFront()
    await expect(recipientPage.locator('[aria-label="1 unread messages"]:visible')).toBeVisible({ timeout: 30_000 })
    await expect(recipientPage.getByLabel(`Unread conversation with ${users.sender.fullName}`)).toBeVisible({ timeout: 30_000 })

    await recipientPage.getByRole('link', { name: `Open conversation with ${users.sender.fullName}` }).click()
    await recipientPage.waitForURL((url) => url.pathname === `/messages/${conversationId}`, { timeout: 20_000 })
    await expect(recipientPage.getByText(messageBody, { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(recipientPage.locator('[aria-label="1 unread messages"]:visible')).toHaveCount(0, { timeout: 30_000 })
    await expect(recipientPage.getByLabel(`Unread conversation with ${users.sender.fullName}`)).toHaveCount(0, { timeout: 30_000 })

    await senderPage.waitForFunction(({ conversationId }) => {
      const signals = globalThis.__realtime_sender_signals ?? []
      return signals.some((signal) => signal?.eventType === 'conversation.read_cursor_advanced' && signal?.payload?.conversationId === conversationId)
    }, { conversationId }, { timeout: 30_000 })
    console.log('REALTIME_E2E_READ_CURSOR_SIGNAL_VERIFIED=true')
    console.log('REALTIME_E2E_UNREAD_BADGE_CLEARED=true')
    console.log('REALTIME_E2E_LIVE_INBOX_NO_RELOAD_VERIFIED=true')

    const followUpBody = `${messageBody} live follow-up`
    await senderPage.getByLabel('Write a message').fill(followUpBody)
    await senderPage.getByRole('button', { name: 'Send message' }).click()
    await expect(senderPage.getByText(followUpBody, { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(recipientPage.getByText(followUpBody, { exact: true })).toBeVisible({ timeout: 30_000 })
    await senderPage.waitForFunction(({ conversationId }) => {
      const signals = globalThis.__realtime_sender_signals ?? []
      return signals.filter((signal) => signal?.eventType === 'conversation.read_cursor_advanced' && signal?.payload?.conversationId === conversationId).length >= 2
    }, { conversationId }, { timeout: 30_000 })
    console.log('REALTIME_E2E_ACTIVE_THREAD_NO_RELOAD_VERIFIED=true')

    await senderPage.evaluate((injectedBody) => {
      const socket = globalThis.__realtime_sender_socket
      if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('probe_socket_not_open')
      socket.send(JSON.stringify({ action: 'send-message', body: injectedBody }))
    }, injectedBody)
    await new Promise((resolve) => setTimeout(resolve, 1500))

    await closeProbeSocket(senderPage, 'sender')
    await closeProbeSocket(recipientPage, 'recipient')

    await recipientPage.reload({ waitUntil: 'domcontentloaded' })
    await expect(recipientPage.getByText(messageBody, { exact: true })).toBeVisible({ timeout: 20_000 })
    console.log('REALTIME_E2E_CANONICAL_FALLBACK_VERIFIED=true')
  } finally {
    await senderContext.close()
    await recipientContext.close()
    await anonymousContext.close()
  }
}

try {
  if (phase === 'signup') {
    await signUp(users.sender)
    await signUp(users.recipient)
    console.log('REALTIME_E2E_SIGNUP_VERIFIED=true')
  } else if (phase === 'onboarding') {
    await completeProfessional(users.sender, 'sender')
    await completeProfessional(users.recipient, 'recipient')
    console.log('REALTIME_E2E_ONBOARDING_VERIFIED=true')
  } else if (phase === 'connect-probe') {
    await connectProbeJourney()
  } else if (phase === 'social') {
    await socialJourney()
  } else if (phase === 'realtime') {
    await realtimeJourney()
    console.log('REALTIME_E2E_BROWSER_VERIFIED=true')
  }
} finally {
  await browser.close()
}
