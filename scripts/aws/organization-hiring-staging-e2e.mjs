import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

const siteUrl = process.env.SITE_URL
const phase = process.env.E2E_PHASE
const runId = process.env.GITHUB_RUN_ID
const organizationName = process.env.E2E_ORGANIZATION_NAME
const jobTitle = process.env.E2E_JOB_TITLE
const applicationId = process.env.E2E_APPLICATION_ID
const jobId = process.env.E2E_JOB_ID

const users = {
  applicant: {
    email: process.env.E2E_APPLICANT_EMAIL,
    password: process.env.E2E_APPLICANT_PASSWORD,
    fullName: process.env.E2E_APPLICANT_NAME,
  },
  admin: {
    email: process.env.E2E_ADMIN_EMAIL,
    password: process.env.E2E_ADMIN_PASSWORD,
    fullName: process.env.E2E_ADMIN_NAME,
  },
  unauthorized: {
    email: process.env.E2E_UNAUTHORIZED_EMAIL,
    password: process.env.E2E_UNAUTHORIZED_PASSWORD,
    fullName: process.env.E2E_UNAUTHORIZED_NAME,
  },
}

assert.ok(siteUrl, 'SITE_URL is required')
assert.ok(runId, 'GITHUB_RUN_ID is required')
assert.ok(['signup', 'onboarding', 'applicant-submit', 'admin-approve', 'owner-post', 'unauthorized'].includes(phase), 'Unsupported E2E_PHASE')
for (const [key, user] of Object.entries(users)) {
  assert.match(user.email ?? '', new RegExp(`^sea-n-shore-hiring-e2e-[0-9]+-${key}@example\\.com$`))
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
    if (request.url().startsWith(siteUrl)) requestFailures.push({ method: request.method(), url: request.url(), failure: request.failure()?.errorText ?? 'unknown' })
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
    throw new Error(`Public sign-up failed for ${user.email}: state=${outcome?.kind ?? 'timeout'} text=${outcome?.text?.trim() || 'none'} posts=${JSON.stringify(postObservations)} requestFailures=${JSON.stringify(requestFailures)} consoleErrors=${JSON.stringify(consoleErrors)}`)
  }
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible()
  await context.close()
}

async function signInForOnboarding(page, user) {
  await page.goto(`${siteUrl}/auth/sign-in`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/onboarding', { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Set your course in the global shipping community.' })).toBeVisible()
}

async function signInCompleted(page, user) {
  await page.goto(`${siteUrl}/auth/sign-in`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/home', { timeout: 20_000 })
}

async function completeApplicantOrganisation() {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInForOnboarding(page, users.applicant)
  await page.getByRole('button', { name: /Organisation Represent a maritime organisation/ }).click()
  await page.getByLabel('Search organisation identities').fill('Shipowner')
  await page.getByRole('button', { name: 'Shipowner — Shipping & Ship Management' }).click()
  await expect(page.locator('[data-primary-identity="true"]')).toHaveText('Shipowner')
  await page.getByLabel('Organisation name').fill(`E2E Applicant Maritime ${runId}`)
  await page.getByLabel('Profile address').fill(`sns-hiring-applicant-${runId}`)
  await page.getByLabel('Location').fill('Mumbai')
  await page.getByRole('button', { name: 'Complete profile' }).click()
  await page.waitForURL((url) => url.pathname === '/hiring/organization', { timeout: 20_000 })
  await context.close()
}

async function completeProfessional(user, slugSuffix, organisation) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInForOnboarding(page, user)
  await page.getByRole('button', { name: /Professional Build your individual maritime identity/ }).click()
  await page.getByLabel('Search professional identities').fill('Master')
  await page.getByRole('button', { name: 'Master — Sea-going · Deck' }).click()
  await expect(page.locator('[data-primary-identity="true"]')).toHaveText('Master')
  await page.getByLabel('Profile address').fill(`sns-hiring-${slugSuffix}-${runId}`)
  await page.getByLabel('Location').fill('Mumbai')
  await page.getByLabel('Current organisation').fill(organisation)
  await page.getByRole('button', { name: 'Complete profile' }).click()
  await page.waitForURL((url) => url.pathname === '/home', { timeout: 20_000 })
  await context.close()
}

async function submitOrganizationApplication() {
  assert.ok(organizationName)
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.applicant)
  await page.goto(`${siteUrl}/hiring/organization`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Organization verification' })).toBeVisible()
  await page.getByLabel('Organization name').fill(organizationName)
  await page.getByLabel('Organization type').fill('Shipowner and Ship Manager')
  await page.getByLabel('Website').fill('https://example.com')
  await page.getByLabel('Official company email').fill(users.applicant.email)
  await page.getByLabel('Office location').fill('Mumbai, India')
  await page.getByLabel('Description').fill('Disposable maritime employer record created only for the guarded Sea N Shore staging hiring end-to-end verification.')
  await page.getByLabel('Fleet summary').fill('Two test-managed tanker vessels used only as structured staging verification data.')
  await page.getByLabel('Vessel types').fill('Oil Tanker, Chemical Tanker')
  await page.getByLabel('Your role / relationship').fill('Director')
  await page.getByLabel('Registration / reference number').fill(`E2E-${runId}`)
  await page.getByLabel('Supporting notes').fill('Guarded staging E2E. This organization and all linked records must be deleted by workflow cleanup.')
  await page.getByRole('button', { name: 'Submit for verification' }).click()
  await expect(page.getByRole('heading', { name: 'Verification in progress' })).toBeVisible({ timeout: 20_000 })
  console.log('ORGANIZATION_HIRING_E2E_APPLICATION_SUBMITTED=true')
  await context.close()
}

async function approveOrganization() {
  assert.match(applicationId ?? '', /^[0-9a-f-]{36}$/)
  assert.ok(organizationName)
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.admin)
  await page.goto(`${siteUrl}/admin/organizations/${applicationId}`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: organizationName })).toBeVisible()
  await expect(page.getByText('Not verified', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Approve organization' }).click()
  await expect(page.getByText('Review decision saved.')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Verified employer', { exact: true })).toBeVisible({ timeout: 20_000 })
  console.log('ORGANIZATION_HIRING_E2E_ADMIN_APPROVAL_UI_VERIFIED=true')
  await context.close()
}

async function postJobAsOwner() {
  assert.ok(jobTitle)
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.applicant)
  await page.goto(`${siteUrl}/hiring`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Hiring', exact: true })).toBeVisible()
  await expect(page.getByText('Verified company', { exact: true })).toBeVisible()
  await page.goto(`${siteUrl}/hiring/jobs/new`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Post a maritime job' })).toBeVisible()
  await page.getByLabel('Job title').fill(jobTitle)
  await page.getByLabel('Job type').selectOption('sea')
  await page.getByLabel('Department').fill('Deck')
  await page.getByLabel('Rank / position').fill('Chief Officer')
  await page.getByLabel('Location').fill('Worldwide')
  await page.getByLabel('Summary').fill('Chief Officer required for a disposable staging tanker vacancy used to verify the complete hiring authorization flow.')
  await page.getByLabel('Description').fill('Join an oil tanker for a guarded staging-only vacancy. This posting verifies verified-company authorization, structured maritime requirements and publication, then is deleted automatically.')
  await page.getByLabel('Vessel types').fill('Oil Tanker, Chemical Tanker')
  await page.getByLabel('Minimum years').fill('2')
  await page.getByLabel('Maximum years').fill('8')
  await page.getByLabel('Sailing regions').fill('Worldwide, Middle East')
  await page.getByLabel('Certificates').fill('STCW, Advanced Oil Tanker')
  await page.getByLabel('Visas').fill('US C1/D')
  await page.getByLabel('Other requirements').fill('Valid medical and tanker sea service required for this staging-only test vacancy.')
  await page.getByLabel('Salary minimum').fill('7000')
  await page.getByLabel('Salary maximum').fill('8500')
  await page.getByLabel('Currency').fill('USD')
  await page.getByLabel('Salary period').selectOption('month')
  await page.getByLabel('Urgent joining').check()
  await page.getByLabel('Status').selectOption('published')
  await page.getByRole('button', { name: 'Create job' }).click()
  await page.waitForURL((url) => url.pathname === '/hiring/jobs', { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Company jobs' })).toBeVisible()
  await expect(page.getByRole('heading', { name: jobTitle })).toBeVisible()
  await expect(page.getByText('published', { exact: true })).toBeVisible()
  console.log('ORGANIZATION_HIRING_E2E_OWNER_JOB_UI_VERIFIED=true')
  await context.close()
}

async function verifyUnauthorized() {
  assert.match(jobId ?? '', /^[0-9a-f-]{36}$/)
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.unauthorized)
  await page.goto(`${siteUrl}/hiring/jobs/new`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Hiring access required' })).toBeVisible()
  await page.goto(`${siteUrl}/hiring`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Hiring access' })).toBeVisible()
  const crossCompanyResponse = await page.goto(`${siteUrl}/hiring/jobs/${jobId}/edit`, { waitUntil: 'networkidle' })
  assert.equal(crossCompanyResponse?.status(), 404, 'Unauthorized cross-company edit route must return 404')
  console.log('ORGANIZATION_HIRING_E2E_UNAUTHORIZED_UI_VERIFIED=true')
  await context.close()
}

try {
  if (phase === 'signup') {
    await signUp(users.applicant)
    await signUp(users.admin)
    await signUp(users.unauthorized)
    console.log('ORGANIZATION_HIRING_E2E_PUBLIC_SIGNUP_VERIFIED=true')
  } else if (phase === 'onboarding') {
    await completeApplicantOrganisation()
    await completeProfessional(users.admin, 'admin', 'Sea N Shore E2E Admin')
    await completeProfessional(users.unauthorized, 'unauthorized', 'Sea N Shore E2E Visitor')
    console.log('ORGANIZATION_HIRING_E2E_ONBOARDING_VERIFIED=true')
  } else if (phase === 'applicant-submit') {
    await submitOrganizationApplication()
  } else if (phase === 'admin-approve') {
    await approveOrganization()
  } else if (phase === 'owner-post') {
    await postJobAsOwner()
  } else if (phase === 'unauthorized') {
    await verifyUnauthorized()
  }
} finally {
  await browser.close()
}
