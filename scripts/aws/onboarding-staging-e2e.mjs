import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const siteUrl = process.env.SITE_URL
const phase = process.env.E2E_PHASE
const runId = process.env.GITHUB_RUN_ID
const SIGNUP_THROTTLE_MESSAGE = 'Too many sign-up requests. Please wait a moment and try again.'
const SIGNUP_THROTTLE_RETRY_DELAYS_MS = [15_000, 30_000, 60_000]
const SIGNUP_INTER_USER_DELAY_MS = 15_000

const personaSpecs = [
  {
    key: 'other',
    mobile: true,
    label: 'Other',
    intent: 'Host events',
    fields: [
      ['Location', 'Chennai'],
      ['How would you describe yourself?', 'Maritime technology supporter'],
    ],
  },
  {
    key: 'seafarer',
    label: 'Seafarer',
    intent: 'Find jobs',
    fields: [
      ['Location', 'Mumbai'],
      ['Current or most recent rank', 'Chief Engineer'],
      ['Current / last organisation', 'E2E Shipping'],
    ],
    verifyUsernameLifecycle: true,
  },
  {
    key: 'shore',
    label: 'Shore Professional',
    intent: 'Network',
    fields: [
      ['Location', 'Singapore'],
      ['Current role / designation', 'Marine Superintendent'],
      ['Current organisation', 'E2E Shore'],
    ],
  },
  {
    key: 'recruiter',
    label: 'Recruiter / HR',
    intent: 'Hire people',
    fields: [
      ['Location', 'Mumbai'],
      ['Role / designation', 'Crewing Manager'],
      ['Current organisation', 'E2E Manning'],
    ],
  },
  {
    key: 'trainer',
    label: 'Trainer / Instructor',
    intent: 'Teach',
    fields: [
      ['Location', 'Kochi'],
      ['Training specialization', 'SIRE 2.0'],
      ['Organisation / institute', 'E2E Academy'],
    ],
  },
  {
    key: 'student',
    mobile: true,
    label: 'Student / Cadet',
    intent: 'Learn',
    fields: [
      ['Location', 'Pune'],
      ['Institute / academy', 'E2E Maritime Institute'],
    ],
  },
  {
    key: 'family',
    mobile: true,
    label: 'Seafarer Family',
    intent: 'Community',
    fields: [
      ['Location', 'Goa'],
      ['Relationship to the maritime community', 'Spouse / partner'],
    ],
  },
  {
    key: 'enthusiast',
    mobile: true,
    label: 'Maritime Enthusiast',
    intent: 'Attend events',
    fields: [
      ['Location', 'Visakhapatnam'],
    ],
  },
]

const personaMarkers = {
  seafarer: 'ONBOARDING_E2E_PERSONA_SEAFARER_VERIFIED=true',
  shore: 'ONBOARDING_E2E_PERSONA_SHORE_VERIFIED=true',
  recruiter: 'ONBOARDING_E2E_PERSONA_RECRUITER_VERIFIED=true',
  trainer: 'ONBOARDING_E2E_PERSONA_TRAINER_VERIFIED=true',
  student: 'ONBOARDING_E2E_PERSONA_STUDENT_VERIFIED=true',
  family: 'ONBOARDING_E2E_PERSONA_FAMILY_VERIFIED=true',
  enthusiast: 'ONBOARDING_E2E_PERSONA_ENTHUSIAST_VERIFIED=true',
  other: 'ONBOARDING_E2E_PERSONA_OTHER_VERIFIED=true',
}

const users = personaSpecs.map((spec) => {
  const prefix = 'E2E_' + spec.key.toUpperCase()
  return {
    ...spec,
    email: process.env[prefix + '_EMAIL'],
    password: process.env[prefix + '_PASSWORD'],
    fullName: process.env[prefix + '_NAME'],
  }
})

assert.ok(siteUrl, 'SITE_URL is required')
assert.match(runId ?? '', /^\d+$/, 'GITHUB_RUN_ID is required')
assert.ok(['signup', 'journeys'].includes(phase), 'E2E_PHASE must be signup or journeys')
for (const user of users) {
  const emailPattern = new RegExp('^sea-n-shore-e2e-[0-9]+-' + user.key + '@example\\.com$')
  assert.match(user.email ?? '', emailPattern)
  assert.ok((user.password ?? '').length >= 12)
  assert.ok(user.fullName)
}

function e2eUsername(kind) {
  const value = 'e2e-' + kind + '-' + runId
  assert.ok(value.length <= 30, 'Disposable username is too long: ' + value)
  return value
}

function usernameInput(page) {
  return page.locator('input[name="slug"]')
}

const browser = await chromium.launch()

async function verifyAccessibility(page, label) {
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations
    .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.slice(0, 3).flatMap((node) => node.target),
    }))

  assert.deepEqual(blocking, [], label + ' has serious or critical accessibility violations')
  console.log('ONBOARDING_E2E_ACCESSIBILITY_VERIFIED=true')
}

async function verifyMobileLayout(page, label) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth + 1,
    label + ' onboarding overflows horizontally: ' + JSON.stringify(dimensions),
  )
  console.log('ONBOARDING_E2E_MOBILE_LAYOUT_VERIFIED=true')
}

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

  try {
    for (let attempt = 0; attempt <= SIGNUP_THROTTLE_RETRY_DELAYS_MS.length; attempt += 1) {
      await page.goto(siteUrl + '/auth/sign-up', { waitUntil: 'networkidle' })
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

      if (outcome?.kind === 'confirm') {
        await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible()
        return 'confirmed'
      }

      const safeText = outcome?.text?.trim() || 'no rendered auth status'
      const retryDelay = SIGNUP_THROTTLE_RETRY_DELAYS_MS[attempt]
      if (outcome?.kind === 'error' && safeText === SIGNUP_THROTTLE_MESSAGE) {
        if (retryDelay !== undefined) {
          console.log('ONBOARDING_E2E_SIGNUP_THROTTLE_RETRY=' + (attempt + 1))
          await page.waitForTimeout(retryDelay)
          continue
        }
        console.log('ONBOARDING_E2E_PUBLIC_SIGNUP_THROTTLED=true')
        throw new Error('Public sign-up remained throttled after bounded retries.')
      }

      const posts = postObservations.length ? JSON.stringify(postObservations) : 'none'
      const failures = requestFailures.length ? JSON.stringify(requestFailures) : 'none'
      const consoles = consoleErrors.length ? JSON.stringify(consoleErrors) : 'none'
      throw new Error('Public sign-up did not reach confirmation. path=' + new URL(page.url()).pathname + ' state=' + (outcome?.kind ?? 'timeout') + ' text=' + safeText + ' posts=' + posts + ' requestFailures=' + failures + ' consoleErrors=' + consoles)
    }
  } finally {
    await context.close()
  }
}

async function signIn(page, user) {
  await page.goto(siteUrl + '/auth/sign-in', { waitUntil: 'networkidle' })
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
  const response = await page.goto(siteUrl + '/people/' + username, { waitUntil: 'domcontentloaded' })
  assert.equal(response?.status(), 200, 'Expected /people/' + username + ' to resolve successfully')
  await expect(page.getByText(fullName, { exact: true }).first()).toBeVisible()
  await expect(page.getByText('@' + username, { exact: true }).first()).toBeVisible()
}

async function verifyExistingLegacyProfileUrl(page) {
  await page.goto(siteUrl + '/network', { waitUntil: 'networkidle' })
  const hrefs = await page.locator('a[href^="/people/"]').evaluateAll((anchors) => anchors
    .map((anchor) => anchor.getAttribute('href'))
    .filter((href) => typeof href === 'string'))
  const legacyHref = [...new Set(hrefs)].find((href) => {
    const slug = href.slice('/people/'.length).split(/[?#]/, 1)[0]
    return slug && !slug.startsWith('e2e-')
  })
  assert.ok(legacyHref, 'Expected at least one existing non-E2E profile URL on the live network page')

  const response = await page.goto(siteUrl + legacyHref, { waitUntil: 'domcontentloaded' })
  assert.equal(response?.status(), 200, 'Existing pre-E2E profile URL should continue to resolve')
  await expect(page.locator('main')).toBeVisible()
  console.log('ONBOARDING_E2E_LEGACY_PROFILE_URL_VERIFIED=true')
}

async function verifyUsernameBeforeCompletion(page, takenUsername, initialUsername) {
  const usernameField = usernameInput(page)

  await usernameField.fill('Bad Slug!!')
  await expect(page.getByText('Use letters, numbers, dots, underscores, or hyphens; start and end with a letter or number.', { exact: true })).toBeVisible()

  await usernameField.fill('admin')
  await expect(page.getByText('That username is reserved.', { exact: true })).toBeVisible()
  console.log('ONBOARDING_E2E_USERNAME_RESERVED_VERIFIED=true')

  await usernameField.fill(takenUsername)
  await expect(page.getByText('That username is already taken.', { exact: true })).toBeVisible({ timeout: 10_000 })

  await usernameField.fill('E2E-Seafarer-' + runId)
  await expect(usernameField).toHaveValue(initialUsername)
  console.log('ONBOARDING_E2E_USERNAME_LOWERCASE_VERIFIED=true')
  await expect(page.getByText('Checking username…', { exact: true })).toBeVisible()
  console.log('ONBOARDING_E2E_USERNAME_CHECKING_GUARD_VERIFIED=true')
  await expect(page.getByText('Username is available.', { exact: true })).toBeVisible({ timeout: 10_000 })
  console.log('ONBOARDING_E2E_USERNAME_AVAILABILITY_VERIFIED=true')
}

async function verifyUsernameEditLifecycle(page, user, initialUsername, takenUsername) {
  const firstChangedUsername = e2eUsername('sea1')
  const secondChangedUsername = e2eUsername('sea2')
  const blockedThirdUsername = e2eUsername('sea3')

  await page.goto(siteUrl + '/profile/edit', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Edit profile' })).toBeVisible()
  await expect(page.getByText('Username changes remaining: 2 of 2.', { exact: true })).toBeVisible()
  await expect(usernameInput(page)).toHaveValue(initialUsername)
  await expect(page.getByText('This is your current username.', { exact: true })).toBeVisible()
  console.log('ONBOARDING_E2E_USERNAME_CURRENT_VERIFIED=true')
  console.log('ONBOARDING_E2E_USERNAME_INITIAL_BUDGET_VERIFIED=true')

  const about = page.getByLabel('About')
  if (await about.count()) {
    await about.fill('Disposable onboarding E2E profile used to verify username protections.')
  }
  const rank = page.getByLabel('Rank')
  if (await rank.count()) await rank.fill('Chief Engineer')

  const editUsername = usernameInput(page)
  const saveButton = page.getByRole('button', { name: 'Save changes' })

  await editUsername.fill('Bad Slug!!')
  await expect(page.getByText('Use letters, numbers, dots, underscores, or hyphens; start and end with a letter or number.', { exact: true })).toBeVisible()

  await editUsername.fill('admin')
  await expect(page.getByText('That username is reserved.', { exact: true })).toBeVisible()

  await editUsername.fill(takenUsername)
  await expect(page.getByText('That username is already taken.', { exact: true })).toBeVisible({ timeout: 10_000 })

  await expectUsernameAvailable(page, firstChangedUsername)
  await saveButton.click()
  await page.waitForURL((url) => url.pathname === '/profile', { timeout: 20_000 })
  await expect(page.getByText('@' + firstChangedUsername, { exact: true })).toBeVisible()
  await expectPublicProfileUrl(page, firstChangedUsername, user.fullName)

  await page.goto(siteUrl + '/profile/edit', { waitUntil: 'networkidle' })
  await expect(page.getByText('Username changes remaining: 1 of 2.', { exact: true })).toBeVisible()
  await expect(usernameInput(page)).toHaveValue(firstChangedUsername)
  await expect(page.getByText('This is your current username.', { exact: true })).toBeVisible()
  await expectUsernameAvailable(page, secondChangedUsername)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.waitForURL((url) => url.pathname === '/profile', { timeout: 20_000 })
  await expect(page.getByText('@' + secondChangedUsername, { exact: true })).toBeVisible()
  await expectPublicProfileUrl(page, secondChangedUsername, user.fullName)
  console.log('ONBOARDING_E2E_USERNAME_PUBLIC_URL_VERIFIED=true')

  await page.goto(siteUrl + '/profile/edit', { waitUntil: 'networkidle' })
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
}

async function completePersona(user, takenUsername) {
  const context = await browser.newContext(user.mobile ? { viewport: { width: 390, height: 844 } } : {})
  const page = await context.newPage()
  await signIn(page, user)

  const personaButton = page.getByRole('button', {
    name: user.label,
    exact: true,
  })
  await personaButton.click()
  await expect(personaButton).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('What are you here to do?', { exact: true })).toBeVisible()

  const intentButton = page.getByRole('button', { name: user.intent, exact: true })
  await intentButton.click()
  await expect(intentButton).toHaveAttribute('aria-pressed', 'true')

  for (const [label, value] of user.fields) {
    await page.getByLabel(label, { exact: true }).fill(value)
  }

  await verifyAccessibility(page, user.label)
  if (user.mobile) await verifyMobileLayout(page, user.label)

  const username = e2eUsername(user.key)
  if (user.verifyUsernameLifecycle) {
    assert.ok(takenUsername, 'Seafarer journey requires an already-used E2E username')
    await verifyUsernameBeforeCompletion(page, takenUsername, username)
  } else {
    await expectUsernameAvailable(page, username)
  }

  await page.getByRole('button', { name: 'Complete profile' }).click()
  await page.waitForURL((url) => url.pathname === '/home', { timeout: 20_000 })

  await page.goto(siteUrl + '/profile', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText(user.fullName, { exact: true }).first()).toBeVisible()
  await expect(page.getByText('@' + username, { exact: true })).toBeVisible()

  if (user.verifyUsernameLifecycle) {
    await verifyExistingLegacyProfileUrl(page)
    await verifyUsernameEditLifecycle(page, user, username, takenUsername)
  }

  console.log(personaMarkers[user.key])
  await context.close()
  return username
}

try {
  if (phase === 'signup') {
    for (const [index, user] of users.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, SIGNUP_INTER_USER_DELAY_MS))
      const signupOutcome = await signUp(user)
      assert.equal(signupOutcome, 'confirmed')
      console.log('ONBOARDING_E2E_PUBLIC_SIGNUP_USER_VERIFIED=' + user.key)
    }
    console.log('ONBOARDING_E2E_PUBLIC_SIGNUP_VERIFIED=true')
  } else {
    const other = users.find((user) => user.key === 'other')
    assert.ok(other)
    const takenUsername = await completePersona(other)

    const seafarer = users.find((user) => user.key === 'seafarer')
    assert.ok(seafarer)
    await completePersona(seafarer, takenUsername)

    for (const user of users) {
      if (user.key === 'other' || user.key === 'seafarer') continue
      await completePersona(user)
    }
    console.log('ONBOARDING_E2E_ALL_PERSONAS_VERIFIED=true')
  }
} finally {
  await browser.close()
}
