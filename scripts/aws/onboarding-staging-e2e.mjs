import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

const siteUrl = process.env.SITE_URL
const phase = process.env.E2E_PHASE
const users = [
  {
    key: 'professional',
    email: process.env.E2E_PROFESSIONAL_EMAIL,
    password: process.env.E2E_PROFESSIONAL_PASSWORD,
    fullName: process.env.E2E_PROFESSIONAL_NAME,
  },
  {
    key: 'custom',
    email: process.env.E2E_CUSTOM_EMAIL,
    password: process.env.E2E_CUSTOM_PASSWORD,
    fullName: process.env.E2E_CUSTOM_NAME,
  },
  {
    key: 'organisation',
    email: process.env.E2E_ORGANISATION_EMAIL,
    password: process.env.E2E_ORGANISATION_PASSWORD,
    fullName: process.env.E2E_ORGANISATION_NAME,
  },
]

assert.ok(siteUrl, 'SITE_URL is required')
assert.ok(['signup', 'journeys'].includes(phase), 'E2E_PHASE must be signup or journeys')
for (const user of users) {
  assert.match(user.email ?? '', /^sea-n-shore-e2e-[0-9]+-(professional|custom|organisation)@example\.com$/)
  assert.ok((user.password ?? '').length >= 12)
  assert.ok(user.fullName)
}

const browser = await chromium.launch()

async function signUp(user) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const postObservations = []
  const requestFailures = []
  const consoleErrors = []
  const startedAt = Date.now()

  page.on('response', (response) => {
    const request = response.request()
    if (request.method() === 'POST' && response.url().startsWith(siteUrl)) {
      postObservations.push({ status: response.status(), url: response.url(), elapsedMs: Date.now() - startedAt })
    }
  })
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(siteUrl)) {
      requestFailures.push({ method: request.method(), url: request.url(), failure: request.failure()?.errorText ?? 'unknown' })
    }
  })
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 500))
  })

  await page.goto(`${siteUrl}/auth/sign-up`, { waitUntil: 'networkidle' })
  await page.getByLabel('Full name').fill(user.fullName)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Create account' }).click()

  const authError = page.locator('p[role="alert"]')
  const authStatus = page.locator('p[role="status"]')
  const outcome = await Promise.race([
    page.waitForURL((url) => url.pathname === '/auth/sign-up' && url.searchParams.get('confirm') === '1', { timeout: 30_000 }).then(() => ({ kind: 'confirm' })),
    authError.waitFor({ state: 'visible', timeout: 30_000 }).then(async () => ({ kind: 'error', text: await authError.innerText() })),
    authStatus.waitFor({ state: 'visible', timeout: 30_000 }).then(async () => ({ kind: 'status', text: await authStatus.innerText() })),
  ]).catch(() => null)

  if (!outcome || outcome.kind !== 'confirm') {
    const safeText = outcome?.text?.trim() || 'no rendered auth status'
    const posts = postObservations.length ? JSON.stringify(postObservations) : 'none'
    const failures = requestFailures.length ? JSON.stringify(requestFailures) : 'none'
    const consoles = consoleErrors.length ? JSON.stringify(consoleErrors) : 'none'
    throw new Error(`Public sign-up did not reach confirmation. path=${new URL(page.url()).pathname} state=${outcome?.kind ?? 'timeout'} text=${safeText} posts=${posts} requestFailures=${failures} consoleErrors=${consoles}`)
  }

  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible()
  await context.close()
}

async function signIn(page, user) {
  await page.goto(`${siteUrl}/auth/sign-in`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/onboarding', { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Set your course in the global shipping community.' })).toBeVisible()
}

async function completeProfessional(user) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, user)

  await page.getByRole('button', { name: /Professional Build your individual maritime identity/ }).click()
  await page.getByLabel('Search professional identities').fill('Master')
  await page.getByRole('button', { name: 'Master — Sea-going · Deck' }).click()
  await expect(page.locator('[data-primary-identity="true"]')).toHaveText('Master')

  await page.getByLabel('Search additional identities').fill('Mentor')
  await page.locator('button').filter({ hasText: /^MentorProfessional Capacities$/ }).click()
  await expect(page.getByRole('button', { name: 'Remove Mentor' })).toBeVisible()

  const slug = `sea-n-shore-e2e-professional-${process.env.GITHUB_RUN_ID}`
  await page.getByLabel('Profile address').fill('Bad Slug!!')
  await page.getByLabel('Location').fill('Mumbai')
  await page.getByLabel('Current organisation').fill('E2E Shipping')
  await page.getByRole('button', { name: 'Complete profile' }).click()
  await expect(page.getByText('Use letters, numbers, and single hyphens.')).toBeVisible()
  await expect(page.locator('[data-primary-identity="true"]')).toHaveText('Master')
  await expect(page.getByLabel('Location')).toHaveValue('Mumbai')
  await expect(page.getByLabel('Current organisation')).toHaveValue('E2E Shipping')

  await page.getByLabel('Profile address').fill(slug)
  await page.getByRole('button', { name: 'Complete profile' }).click()
  await page.waitForURL((url) => url.pathname === '/home', { timeout: 20_000 })

  await page.goto(`${siteUrl}/profile`, { waitUntil: 'networkidle' })
  await expect(page.getByText('Master', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Mentor', { exact: true }).first()).toBeVisible()

  await page.goto(`${siteUrl}/profile/edit`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Edit profile' })).toBeVisible()

  await page.goto(`${siteUrl}/events`, { waitUntil: 'networkidle' })
  await expect(page).toHaveURL((url) => url.pathname === '/events')
  await expect(page.getByRole('heading', { name: 'Maritime events' })).toBeVisible()
  await expect(page.getByRole('search', { name: 'Event search preview' })).toContainText('Search events, topics, speakers or organisations')
  await expect(page.getByRole('heading', { name: 'Upcoming events' })).toBeVisible()
  await expect(page.getByText('No published maritime events yet.', { exact: true })).toBeVisible()
  await expect(page.getByText('Expert webinars', { exact: true })).toBeVisible()
  console.log('ONBOARDING_E2E_EVENTS_VERIFIED=true')

  await context.close()
}

async function completeCustom(user) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, user)

  await page.getByRole('button', { name: /Professional Build your individual maritime identity/ }).click()
  await page.getByRole('button', { name: /Can’t find your role\? Add a custom identity/ }).click()
  await page.getByLabel('Custom maritime identity').fill('Hydrographic Survey Expedition Lead')
  await page.getByRole('button', { name: 'Use this identity' }).click()
  await expect(page.locator('[data-primary-identity="true"]')).toHaveText('Hydrographic Survey Expedition Lead')

  await page.getByLabel('Profile address').fill(`sea-n-shore-e2e-custom-${process.env.GITHUB_RUN_ID}`)
  await page.getByLabel('Location').fill('Goa')
  await page.getByLabel('Current organisation').fill('E2E Hydro')
  await page.getByRole('button', { name: 'Complete profile' }).click()
  await page.waitForURL((url) => url.pathname === '/home', { timeout: 20_000 })
  await page.goto(`${siteUrl}/profile`, { waitUntil: 'networkidle' })
  await expect(page.getByText('Hydrographic Survey Expedition Lead', { exact: true }).first()).toBeVisible()
  await context.close()
}

async function completeOrganisation(user) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, user)

  await page.getByRole('button', { name: /Organisation Represent a maritime organisation/ }).click()
  await page.getByLabel('Search organisation identities').fill('Shipowner')
  await page.getByRole('button', { name: 'Shipowner — Shipping & Ship Management' }).click()
  await expect(page.locator('[data-primary-identity="true"]')).toHaveText('Shipowner')

  await page.getByLabel('Organisation name').fill('E2E Shipowner Organisation')
  await page.getByLabel('Profile address').fill(`sea-n-shore-e2e-organisation-${process.env.GITHUB_RUN_ID}`)
  await page.getByLabel('Location').fill('Mumbai')
  await assert.rejects(async () => page.getByLabel('Current organisation').waitFor({ state: 'visible', timeout: 500 }))
  await page.getByRole('button', { name: 'Complete profile' }).click()
  await page.waitForURL((url) => url.pathname === '/home', { timeout: 20_000 })
  await page.goto(`${siteUrl}/profile`, { waitUntil: 'networkidle' })
  await expect(page.getByText('Shipowner', { exact: true }).first()).toBeVisible()
  await context.close()
}

try {
  if (phase === 'signup') {
    for (const user of users) await signUp(user)
    console.log('ONBOARDING_E2E_PUBLIC_SIGNUP_VERIFIED=true')
  } else {
    await completeProfessional(users[0])
    console.log('ONBOARDING_E2E_PROFESSIONAL_VERIFIED=true')
    await completeCustom(users[1])
    console.log('ONBOARDING_E2E_CUSTOM_VERIFIED=true')
    await completeOrganisation(users[2])
    console.log('ONBOARDING_E2E_ORGANISATION_VERIFIED=true')
  }
} finally {
  await browser.close()
}
