import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

const siteUrl = process.env.SITE_URL
const phase = process.env.E2E_PHASE
const runId = process.env.GITHUB_RUN_ID
const conversationId = process.env.E2E_CONVERSATION_ID
const messageBody = process.env.E2E_MESSAGE_BODY
const injectedBody = process.env.E2E_INJECTED_BODY
const users = {
  sender: { email: process.env.E2E_SENDER_EMAIL, password: process.env.E2E_SENDER_PASSWORD, fullName: process.env.E2E_SENDER_NAME },
  recipient: { email: process.env.E2E_RECIPIENT_EMAIL, password: process.env.E2E_RECIPIENT_PASSWORD, fullName: process.env.E2E_RECIPIENT_NAME },
}

assert.ok(siteUrl)
assert.ok(runId)
assert.ok(['signup', 'onboarding', 'realtime'].includes(phase))
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
  await page.getByLabel('Profile address').fill(`sns-realtime-${suffix}-${runId}`)
  await page.getByLabel('Location').fill('Mumbai')
  await page.getByLabel('Current organisation').fill(`Sea N Shore Realtime E2E ${suffix}`)
  await page.getByRole('button', { name: 'Complete profile' }).click()
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
    const url = new URL(payload.websocketUrl)
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
    return { websocketUrl: payload.websocketUrl, expiresAt: payload.expiresAt }
  }, { key })
}

async function closeProbeSocket(page, key) {
  await page.evaluate((key) => {
    const socket = globalThis[`__realtime_${key}_socket`]
    if (socket && socket.readyState < 2) socket.close(1000, 'e2e-complete')
  }, key)
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
    const senderTicket = await openProbeSocket(senderPage, 'sender')
    const recipientTicket = await openProbeSocket(recipientPage, 'recipient')
    assert.match(senderTicket.websocketUrl, /^wss:/)
    assert.equal(senderTicket.websocketUrl, recipientTicket.websocketUrl)

    const malformedRejected = await anonymousPage.evaluate(async (websocketUrl) => {
      const url = new URL(websocketUrl)
      url.searchParams.set('ticket', 'malformed-ticket')
      return await new Promise((resolve) => {
        const socket = new WebSocket(url.toString())
        const timer = setTimeout(() => { try { socket.close() } catch {}; resolve(false) }, 10_000)
        socket.onopen = () => { clearTimeout(timer); socket.close(); resolve(false) }
        socket.onerror = () => {}
        socket.onclose = () => { clearTimeout(timer); resolve(true) }
      })
    }, senderTicket.websocketUrl)
    assert.equal(malformedRejected, true)
    console.log('REALTIME_E2E_MALFORMED_TICKET_REJECTED=true')

    await senderPage.goto(`${siteUrl}/messages/${conversationId}`, { waitUntil: 'domcontentloaded' })
    await recipientPage.goto(`${siteUrl}/messages/${conversationId}`, { waitUntil: 'domcontentloaded' })
    await expect(senderPage.getByLabel('Write a message')).toBeVisible()
    await expect(recipientPage.getByLabel('Write a message')).toBeVisible()

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
    await expect(recipientPage.getByText(messageBody, { exact: true })).toBeVisible({ timeout: 30_000 })
    await recipientPage.getByTestId('message-read-sentinel').scrollIntoViewIfNeeded()
    await recipientPage.waitForFunction(({ conversationId }) => {
      const signals = globalThis.__realtime_recipient_signals ?? []
      return signals.some((signal) => signal?.eventType === 'message.created' && signal?.payload?.conversationId === conversationId)
    }, { conversationId }, { timeout: 10_000 })
    await senderPage.waitForFunction(({ conversationId }) => {
      const signals = globalThis.__realtime_sender_signals ?? []
      return signals.some((signal) => signal?.eventType === 'conversation.read_cursor_advanced' && signal?.payload?.conversationId === conversationId)
    }, { conversationId }, { timeout: 30_000 })
    console.log('REALTIME_E2E_READ_CURSOR_SIGNAL_VERIFIED=true')

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
  } else if (phase === 'realtime') {
    await realtimeJourney()
    console.log('REALTIME_E2E_BROWSER_VERIFIED=true')
  }
} finally {
  await browser.close()
}
