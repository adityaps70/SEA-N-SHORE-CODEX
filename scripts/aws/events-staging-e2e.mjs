import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

const siteUrl = process.env.SITE_URL
const phase = process.env.E2E_PHASE
const runId = process.env.GITHUB_RUN_ID
const eventTitle = process.env.E2E_EVENT_TITLE
const eventId = process.env.E2E_EVENT_ID
const editedSummary = process.env.E2E_EDITED_SUMMARY

const users = {
  host: { email: process.env.E2E_HOST_EMAIL, password: process.env.E2E_HOST_PASSWORD, fullName: process.env.E2E_HOST_NAME },
  attendee: { email: process.env.E2E_ATTENDEE_EMAIL, password: process.env.E2E_ATTENDEE_PASSWORD, fullName: process.env.E2E_ATTENDEE_NAME },
}

assert.ok(siteUrl)
assert.ok(runId)
assert.ok(eventTitle?.startsWith('E2E Maritime Event '))
assert.ok(['signup', 'onboarding', 'host-create', 'attendee-rsvp', 'host-edit', 'attendee-withdraw', 'host-cancel'].includes(phase))
for (const [key, user] of Object.entries(users)) {
  assert.match(user.email ?? '', new RegExp(`^sea-n-shore-events-e2e-[0-9]+-${key}@example\\.com$`))
  assert.ok((user.password ?? '').length >= 12)
  assert.ok(user.fullName)
}
if (!['signup', 'onboarding', 'host-create'].includes(phase)) assert.match(eventId ?? '', /^[0-9a-f-]{36}$/)

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

async function completeProfessional(user, suffix, organisation) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInForOnboarding(page, user)
  await page.getByRole('button', { name: /Professional Build your individual maritime identity/ }).click()
  await page.getByLabel('Search professional identities').fill('Master')
  await page.getByRole('button', { name: 'Master — Sea-going · Deck' }).click()
  await expect(page.locator('[data-primary-identity="true"]')).toHaveText('Master')
  const username = `evt-${suffix}-${runId}`
  assert.ok(username.length <= 30, `Disposable Events E2E username is too long: ${username}`)
  await page.locator('input[name="slug"]').fill(username)
  await expect(page.getByText('Username is available.', { exact: true })).toBeVisible({ timeout: 10_000 })
  await page.getByLabel('Location').fill('Mumbai')
  await page.getByLabel('Current organisation').fill(organisation)
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

async function waitForInteractiveLoad(page) {
  await page.waitForLoadState('load')
}

function futureLocal(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString().slice(0, 16)
}

async function createEvent() {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.host)
  await page.goto(`${siteUrl}/events/create`, { waitUntil: 'domcontentloaded' })
  await waitForInteractiveLoad(page)
  await expect(page.getByRole('heading', { name: 'Create a maritime event' })).toBeVisible()
  await page.locator('input[name="title"]').fill(eventTitle)
  await page.locator('textarea[name="summary"]').fill('Guarded staging event used to verify the complete Sea N Shore Events lifecycle.')
  await page.locator('textarea[name="description"]').fill('Authenticated staging-only maritime event. It is automatically removed after the guarded end-to-end verification.')
  await page.locator('select[name="category"]').selectOption('training')
  await page.locator('select[name="eventType"]').selectOption('masterclass')
  await page.locator('select[name="format"]').selectOption('online')
  await page.locator('input[name="capacity"]').fill('2')
  await page.locator('input[name="startAt"]').fill(futureLocal(72))
  await page.locator('input[name="endAt"]').fill(futureLocal(74))
  await page.locator('input[name="timezone"]').fill('UTC')
  await page.locator('input[name="meetingUrl"]').fill(`https://example.com/events-e2e-${runId}`)
  await page.locator('input[name="topics"]').fill('SIRE 2.0, Human factors')
  await page.locator('textarea[name="agenda"]').fill('Welcome\nSIRE 2.0 readiness\nQuestions and close-out')
  await page.locator('textarea[name="speakerDetails"]').fill('Capt. E2E Host | Master Mariner | Sea N Shore')
  await page.locator('select[name="registrationMode"]').selectOption('open')
  await page.locator('input[name="registrationClosesAt"]').fill(futureLocal(71))
  await page.getByRole('button', { name: 'Publish event' }).click()
  await page.waitForURL((url) => /^\/events\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 30_000 })
  const id = new URL(page.url()).pathname.split('/').pop()
  assert.match(id ?? '', /^[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible()
  await expect(page.getByText('Training', { exact: true })).toBeVisible()
  await expect(page.getByText('Masterclass', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Join online session' })).toBeVisible()

  await page.goto(`${siteUrl}/events`, { waitUntil: 'domcontentloaded' })
  await waitForInteractiveLoad(page)
  const eventCard = page.getByRole('link', { name: `View ${eventTitle}` })
  await expect(eventCard).toBeVisible()
  await expect(eventCard.getByText('View event', { exact: true })).toBeVisible()
  await eventCard.click()
  await page.waitForURL((url) => url.pathname === `/events/${id}`, { timeout: 20_000 })
  console.log('EVENTS_E2E_CARD_NAV_VERIFIED=true')

  console.log(`EVENTS_E2E_EVENT_ID=${id}`)
  console.log('EVENTS_E2E_CREATE_UI_VERIFIED=true')
  await context.close()
}

async function attendeeRsvp() {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.attendee)
  await page.goto(`${siteUrl}/events/${eventId}`, { waitUntil: 'domcontentloaded' })
  await waitForInteractiveLoad(page)
  await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Join online session' })).toHaveCount(0)
  const actionResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().startsWith(siteUrl), { timeout: 20_000 })
  await page.getByRole('button', { name: 'Register for event' }).click()
  const actionResponse = await actionResponsePromise
  assert.ok(actionResponse.status() < 400, `Attend Server Action returned HTTP ${actionResponse.status()}`)
  console.log(`EVENTS_E2E_ATTEND_ACTION_HTTP=${actionResponse.status()}`)
  await expect(page.getByText("You're attending", { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Withdraw attendance' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('link', { name: 'Join online session' })).toBeVisible({ timeout: 20_000 })
  const googleCalendar = page.getByRole('link', { name: 'Google Calendar' })
  await expect(googleCalendar).toBeVisible()
  assert.match(await googleCalendar.getAttribute('href') ?? '', /^https:\/\/calendar\.google\.com\/calendar\/render\?/)
  const icsLink = page.getByRole('link', { name: 'Download .ics' })
  await expect(icsLink).toBeVisible()
  const icsHref = await icsLink.getAttribute('href')
  assert.equal(icsHref, `/events/${eventId}/calendar`)
  const icsResponse = await context.request.get(`${siteUrl}${icsHref}`)
  assert.equal(icsResponse.status(), 200)
  assert.match(icsResponse.headers()['content-type'] ?? '', /^text\/calendar/)
  assert.match(await icsResponse.text(), /BEGIN:VCALENDAR/)
  await expect(page.getByRole('button', { name: 'Share event' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy event link' })).toBeVisible()
  await page.goto(`${siteUrl}/events/my`, { waitUntil: 'domcontentloaded' })
  await waitForInteractiveLoad(page)
  await expect(page.getByText(eventTitle, { exact: true })).toBeVisible()
  await page.goto(`${siteUrl}/events/${eventId}/edit`, { waitUntil: 'domcontentloaded' })
  await waitForInteractiveLoad(page)
  await page.waitForURL((url) => url.pathname === `/events/${eventId}`, { timeout: 20_000 })
  console.log('EVENTS_E2E_RSVP_UI_VERIFIED=true')
  console.log('EVENTS_E2E_ORGANIZER_AUTHORIZATION_UI_VERIFIED=true')
  await context.close()
}

async function hostEdit() {
  assert.ok(editedSummary)
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.host)
  await page.goto(`${siteUrl}/events/${eventId}/edit`, { waitUntil: 'domcontentloaded' })
  await waitForInteractiveLoad(page)
  await expect(page.getByRole('heading', { name: 'Edit event' })).toBeVisible()
  await page.locator('textarea[name="summary"]').fill(editedSummary)
  await page.getByRole('button', { name: 'Save & keep published' }).click()
  await expect(page.getByText('Event updated successfully.', { exact: true })).toBeVisible({ timeout: 20_000 })
  await page.goto(`${siteUrl}/events/${eventId}`, { waitUntil: 'domcontentloaded' })
  await waitForInteractiveLoad(page)
  await expect(page.getByText(editedSummary, { exact: true })).toBeVisible()
  console.log('EVENTS_E2E_EDIT_UI_VERIFIED=true')
  await context.close()
}

async function attendeeWithdraw() {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.attendee)
  await page.goto(`${siteUrl}/events/${eventId}`, { waitUntil: 'domcontentloaded' })
  await waitForInteractiveLoad(page)
  await page.getByRole('button', { name: 'Withdraw attendance' }).click()
  await expect(page.getByRole('button', { name: 'Register for event' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('link', { name: 'Join online session' })).toHaveCount(0)
  await page.goto(`${siteUrl}/events/my`, { waitUntil: 'domcontentloaded' })
  await waitForInteractiveLoad(page)
  await expect(page.getByText(eventTitle, { exact: true })).toHaveCount(0)
  console.log('EVENTS_E2E_WITHDRAW_UI_VERIFIED=true')
  await context.close()
}

async function hostCancel() {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.host)
  await page.goto(`${siteUrl}/events/${eventId}/edit`, { waitUntil: 'domcontentloaded' })
  await waitForInteractiveLoad(page)
  page.once('dialog', async (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Cancel event' }).click()
  await page.waitForURL((url) => url.pathname === `/events/${eventId}`, { timeout: 20_000 })
  await expect(page.getByText('cancelled', { exact: true })).toBeVisible()
  console.log('EVENTS_E2E_CANCEL_UI_VERIFIED=true')
  await context.close()
}

try {
  if (phase === 'signup') {
    await signUp(users.host)
    await signUp(users.attendee)
    console.log('EVENTS_E2E_SIGNUP_VERIFIED=true')
  } else if (phase === 'onboarding') {
    await completeProfessional(users.host, 'host', 'Sea N Shore E2E Host')
    await completeProfessional(users.attendee, 'attendee', 'Sea N Shore E2E Attendee')
    console.log('EVENTS_E2E_ONBOARDING_VERIFIED=true')
  } else if (phase === 'host-create') await createEvent()
  else if (phase === 'attendee-rsvp') await attendeeRsvp()
  else if (phase === 'host-edit') await hostEdit()
  else if (phase === 'attendee-withdraw') await attendeeWithdraw()
  else if (phase === 'host-cancel') await hostCancel()
} finally {
  await browser.close()
}
