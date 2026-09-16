import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

const siteUrl = process.env.SITE_URL
const phase = process.env.E2E_PHASE
const runId = process.env.GITHUB_RUN_ID
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
assert.match(runId ?? '', /^\d+$/, 'GITHUB_RUN_ID is required')
assert.ok(['signup', 'journeys'].includes(phase), 'E2E_PHASE must be signup or journeys')
for (const user of users) {
  assert.match(user.email ?? '', /^sea-n-shore-e2e-[0-9]+-(professional|custom|organisation)@example\.com$/)
  assert.ok((user.password ?? '').length >= 12)
  assert.ok(user.fullName)
}

function e2eUsername(kind) {
  const value = `e2e-${kind}-${runId}`
  assert.ok(value.length <= 30, `Disposable username is too long: ${value}`)
  return value
}

function usernameInput(page) {
  return page.locator('input[name="slug"]')
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

async function expectUsernameAvailable(page, username) {
  await usernameInput(page).fill(username)
  await expect(page.getByText('Username is available.', { exact: true })).toBeVisible({ timeout: 10_000 })
}

async function expectPublicProfileUrl(page, username, fullName) {
  const response = await page.goto(`${siteUrl}/people/${username}`, { waitUntil: 'domcontentloaded' })
  assert.equal(response?.status(), 200, `Expected /people/${username} to resolve successfully`)
  await expect(page.getByText(fullName, { exact: true }).first()).toBeVisible()
  await expect(page.getByText(`@${username}`, { exact: true }).first()).toBeVisible()
}

async function verifyExistingLegacyProfileUrl(page) {
  await page.goto(`${siteUrl}/network`, { waitUntil: 'networkidle' })
  const hrefs = await page.locator('a[href^="/people/"]').evaluateAll((anchors) => anchors
    .map((anchor) => anchor.getAttribute('href'))
    .filter((href) => typeof href === 'string'))
  const legacyHref = [...new Set(hrefs)].find((href) => {
    const slug = href.slice('/people/'.length).split(/[?#]/, 1)[0]
    return slug && !slug.startsWith('e2e-')
  })
  assert.ok(legacyHref, 'Expected at least one existing non-E2E profile URL on the live network page')

  const response = await page.goto(`${siteUrl}${legacyHref}`, { waitUntil: 'domcontentloaded' })
  assert.equal(response?.status(), 200, 'Existing pre-E2E profile URL should continue to resolve')
  await expect(page.locator('main')).toBeVisible()
  console.log('ONBOARDING_E2E_LEGACY_PROFILE_URL_VERIFIED=true')
}

async function completeProfessional(user, takenUsername) {
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

  const initialUsername = e2eUsername('pro')
  const firstChangedUsername = e2eUsername('pro1')
  const secondChangedUsername = e2eUsername('pro2')
  const blockedThirdUsername = e2eUsername('pro3')
  const usernameField = usernameInput(page)
  const completeButton = page.getByRole('button', { name: 'Complete profile' })

  await page.getByLabel('Location').fill('Mumbai')
  await page.getByLabel('Current organisation').fill('E2E Shipping')

  await usernameField.fill('Bad Slug!!')
  await expect(page.getByText('Use letters, numbers, dots, underscores, or hyphens; start and end with a letter or number.', { exact: true })).toBeVisible()
  await expect(completeButton).toBeDisabled()

  await usernameField.fill('admin')
  await expect(page.getByText('That username is reserved.', { exact: true })).toBeVisible()
  await expect(completeButton).toBeDisabled()
  console.log('ONBOARDING_E2E_USERNAME_RESERVED_VERIFIED=true')

  await usernameField.fill(takenUsername)
  await expect(page.getByText('That username is already taken.', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(completeButton).toBeDisabled()

  await usernameField.fill(`E2E-Pro-${runId}`)
  await expect(usernameField).toHaveValue(initialUsername)
  console.log('ONBOARDING_E2E_USERNAME_LOWERCASE_VERIFIED=true')
  await expect(page.getByText('Checking username…', { exact: true })).toBeVisible()
  await expect(completeButton).toBeDisabled()
  console.log('ONBOARDING_E2E_USERNAME_CHECKING_GUARD_VERIFIED=true')
  await expect(page.getByText('Username is available.', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(completeButton).toBeEnabled()
  console.log('ONBOARDING_E2E_USERNAME_AVAILABILITY_VERIFIED=true')
  await completeButton.click()
  await page.waitForURL((url) => url.pathname === '/home', { timeout: 20_000 })

  await page.goto(`${siteUrl}/profile`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Master', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Mentor', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(`@${initialUsername}`, { exact: true })).toBeVisible()
  await verifyExistingLegacyProfileUrl(page)

  await page.goto(`${siteUrl}/profile/edit`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Edit profile' })).toBeVisible()
  await expect(page.getByText('Username changes remaining: 2 of 2.', { exact: true })).toBeVisible()
  await expect(usernameInput(page)).toHaveValue(initialUsername)
  await expect(page.getByText('This is your current username.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  console.log('ONBOARDING_E2E_USERNAME_CURRENT_VERIFIED=true')
  console.log('ONBOARDING_E2E_USERNAME_INITIAL_BUDGET_VERIFIED=true')

  await page.getByLabel('About').fill('Disposable onboarding E2E profile used to verify username protections.')
  const rank = page.getByLabel('Rank')
  if (await rank.count()) await rank.fill('Master')
  const editUsername = usernameInput(page)
  const saveButton = page.getByRole('button', { name: 'Save changes' })

  await editUsername.fill('Bad Slug!!')
  await expect(page.getByText('Use letters, numbers, dots, underscores, or hyphens; start and end with a letter or number.', { exact: true })).toBeVisible()
  await expect(saveButton).toBeDisabled()

  await editUsername.fill('admin')
  await expect(page.getByText('That username is reserved.', { exact: true })).toBeVisible()
  await expect(saveButton).toBeDisabled()

  await editUsername.fill(takenUsername)
  await expect(page.getByText('That username is already taken.', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(saveButton).toBeDisabled()

  await editUsername.fill(firstChangedUsername)
  await expect(page.getByText('Checking username…', { exact: true })).toBeVisible()
  await expect(saveButton).toBeDisabled()
  await expect(page.getByText('Username is available.', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(saveButton).toBeEnabled()
  await saveButton.click()
  await page.waitForURL((url) => url.pathname === '/profile', { timeout: 20_000 })
  await expect(page.getByText(`@${firstChangedUsername}`, { exact: true })).toBeVisible()
  await expectPublicProfileUrl(page, firstChangedUsername, user.fullName)

  await page.goto(`${siteUrl}/profile/edit`, { waitUntil: 'networkidle' })
  await expect(page.getByText('Username changes remaining: 1 of 2.', { exact: true })).toBeVisible()
  await expect(usernameInput(page)).toHaveValue(firstChangedUsername)
  await expect(page.getByText('This is your current username.', { exact: true })).toBeVisible()
  await expectUsernameAvailable(page, secondChangedUsername)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.waitForURL((url) => url.pathname === '/profile', { timeout: 20_000 })
  await expect(page.getByText(`@${secondChangedUsername}`, { exact: true })).toBeVisible()
  await expectPublicProfileUrl(page, secondChangedUsername, user.fullName)
  console.log('ONBOARDING_E2E_USERNAME_PUBLIC_URL_VERIFIED=true')

  await page.goto(`${siteUrl}/profile/edit`, { waitUntil: 'networkidle' })
  await expect(page.getByText('Username changes remaining: 0 of 2.', { exact: true })).toBeVisible()
  await expect(page.getByText('Your username is locked because both username changes have been used.', { exact: true })).toBeVisible()
  const lockedUsername = usernameInput(page)
  await expect(lockedUsername).toHaveValue(secondChangedUsername)
  await expect(lockedUsername).not.toBeEditable()

  await lockedUsername.evaluate((element) => element.removeAttribute('readonly'))
  await lockedUsername.fill(blockedThirdUsername)
  const thirdChangeResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().startsWith(siteUrl),
    { timeout: 20_000 },
  )
  await page.getByRole('button', { name: 'Save changes' }).click()
  await thirdChangeResponse
  await expect(page).toHaveURL((url) => url.pathname === '/profile/edit')
  await expect(usernameInput(page)).toHaveValue(secondChangedUsername, { timeout: 10_000 })
  console.log('ONBOARDING_E2E_USERNAME_THIRD_CHANGE_BLOCKED=true')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(usernameInput(page)).toHaveValue(secondChangedUsername)
  await expect(usernameInput(page)).not.toBeEditable()
  await expect(page.getByText('Username changes remaining: 0 of 2.', { exact: true })).toBeVisible()
  await expect(page.getByText('Your username is locked because both username changes have been used.', { exact: true })).toBeVisible()
  console.log('ONBOARDING_E2E_USERNAME_LIMIT_AUDIT_VERIFIED=true')

  await page.goto(`${siteUrl}/events`, { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL((url) => url.pathname === '/events')
  await expect(page.getByRole('heading', { name: 'Maritime events', exact: true })).toBeVisible()
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

  const username = e2eUsername('custom')
  await expectUsernameAvailable(page, username)
  await page.getByLabel('Location').fill('Goa')
  await page.getByLabel('Current organisation').fill('E2E Hydro')
  await page.getByRole('button', { name: 'Complete profile' }).click()
  await page.waitForURL((url) => url.pathname === '/home', { timeout: 20_000 })
  await page.goto(`${siteUrl}/profile`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Hydrographic Survey Expedition Lead', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(`@${username}`, { exact: true })).toBeVisible()
  await context.close()
  return username
}

async function completeOrganisation(user) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, user)

  await page.getByRole('button', { name: /Organisation Represent a maritime organisation/ }).click()
  await page.getByLabel('Search organisation identities').fill('Shipowner')
  await page.getByRole('button', { name: 'Shipowner — Shipping & Ship Management' }).click()
  await expect(page.locator('[data-primary-identity="true"]')).toHaveText('Shipowner')

  const username = e2eUsername('org')
  await page.getByLabel('Organisation name').fill('E2E Shipowner Organisation')
  await expectUsernameAvailable(page, username)
  await page.getByLabel('Location').fill('Mumbai')
  await assert.rejects(async () => page.getByLabel('Current organisation').waitFor({ state: 'visible', timeout: 500 }))
  await page.getByRole('button', { name: 'Complete profile' }).click()
  await page.waitForURL((url) => url.pathname === '/hiring/organization', { timeout: 20_000 })
  await page.goto(`${siteUrl}/profile`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Shipowner', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(`@${username}`, { exact: true })).toBeVisible()
  await context.close()
}

try {
  if (phase === 'signup') {
    for (const user of users) await signUp(user)
    console.log('ONBOARDING_E2E_PUBLIC_SIGNUP_VERIFIED=true')
  } else {
    const customUsername = await completeCustom(users[1])
    console.log('ONBOARDING_E2E_CUSTOM_VERIFIED=true')
    await completeProfessional(users[0], customUsername)
    console.log('ONBOARDING_E2E_PROFESSIONAL_VERIFIED=true')
    await completeOrganisation(users[2])
    console.log('ONBOARDING_E2E_ORGANISATION_VERIFIED=true')
  }
} finally {
  await browser.close()
}