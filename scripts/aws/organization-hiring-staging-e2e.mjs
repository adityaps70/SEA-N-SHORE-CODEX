import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chromium, expect } from '@playwright/test'
import { chooseSeafarerMaster } from './e2e-onboarding.mjs'
import { freshTotpCode } from './e2e-totp.mjs'

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
assert.ok(['signup', 'onboarding', 'applicant-submit', 'admin-approve', 'owner-post', 'candidate-expired-visibility', 'owner-republish', 'candidate-apply', 'unauthorized'].includes(phase), 'Unsupported E2E_PHASE')
for (const [key, user] of Object.entries(users)) {
  assert.match(user.email ?? '', new RegExp(`^sea-n-shore-hiring-e2e-[0-9]+-${key}@example\\.com$`))
  assert.ok((user.password ?? '').length >= 12)
  assert.ok(user.fullName)
}

const browser = await chromium.launch()

function runFailedJobProbe() {
  try {
    const region = process.env.AWS_REGION || 'ap-south-1'
    const discovery = spawnSync('aws', [
      'ec2', 'describe-instances',
      '--region', region,
      '--filters', 'Name=tag:Name,Values=sea-n-shore-bootstrap', 'Name=instance-state-name,Values=running',
      '--query', 'Reservations[].Instances[].InstanceId',
      '--output', 'json',
    ], { encoding: 'utf8', env: process.env })

    if (discovery.status !== 0) {
      return `probe bootstrap discovery failed: ${(discovery.stderr || discovery.stdout || 'unknown error').trim()}`
    }

    const instanceIds = JSON.parse(discovery.stdout)
    if (!Array.isArray(instanceIds) || instanceIds.length !== 1 || !/^i-[0-9a-f]+$/.test(instanceIds[0])) {
      return `probe bootstrap discovery returned ${JSON.stringify(instanceIds)}`
    }

    const probe = spawnSync(process.execPath, ['scripts/aws/organization-hiring-e2e-ssm.mjs', 'probe-job'], {
      encoding: 'utf8',
      env: { ...process.env, INSTANCE_ID: instanceIds[0] },
    })
    const output = [probe.stdout, probe.stderr].filter(Boolean).join('\n').trim()
    if (probe.status !== 0) return `probe-job failed status=${probe.status}: ${output || 'no output'}`
    return output || 'probe-job completed without output'
  } catch (error) {
    return `probe-job exception: ${error instanceof Error ? error.message : String(error)}`
  }
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
    if (request.url().startsWith(siteUrl)) requestFailures.push({ method: request.method(), url: request.url(), failure: request.failure()?.errorText ?? 'unknown' })
  })
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 500))
  })

  await page.goto(`${siteUrl}/auth/sign-up`, { waitUntil: 'networkidle' })
  await page.getByLabel('Full name').fill(user.fullName)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
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
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/onboarding', { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Set your course in the global shipping community.' })).toBeVisible()
}

async function signInCompleted(page, user) {
  await page.goto(`${siteUrl}/auth/sign-in`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/home', { timeout: 20_000 })
}

/**
 * Persona onboarding no longer creates an organization: the applicant activates as Recruiter / HR (intent: Hire
 * people) and lands on Home, like every persona. The organization page and its hiring access come from the separate
 * registration flow (/organizations/register) in the applicant-submit phase, and from admin approval after that.
 */
async function completeApplicantOrganisation() {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInForOnboarding(page, users.applicant)
  const persona = page.getByRole('button', { name: 'Recruiter / HR', exact: true })
  await persona.click()
  await expect(persona).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('What are you here to do?', { exact: true })).toBeVisible()
  const intent = page.getByRole('button', { name: 'Hire people', exact: true })
  await intent.click()
  await expect(intent).toHaveAttribute('aria-pressed', 'true')
  // Typed without choosing from the list, so it stays profile text and creates no organization page.
  await page.getByLabel('Current organisation', { exact: true }).fill('Sea N Shore E2E Applicant')
  await page.getByLabel('Role', { exact: true }).selectOption('hr_crewing_manager')
  const username = `hire-org-${runId}`
  assert.ok(username.length <= 30, `Disposable hiring username is too long: ${username}`)
  await page.locator('input[name="slug"]').fill(username)
  await expect(page.getByText('Username is available.', { exact: true })).toBeVisible({ timeout: 10_000 })
  await page.getByLabel('Location', { exact: true }).fill('Mumbai')
  const completeButton = page.getByRole('button', { name: 'Complete profile' })
  await expect(completeButton).toBeEnabled()
  await completeButton.click()
  await page.waitForURL((url) => url.pathname === '/home', { timeout: 20_000 })
  await context.close()
}

async function completeProfessional(user, slugSuffix, organisation) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInForOnboarding(page, user)
  await chooseSeafarerMaster(page, { organisation })
  const username = `hire-${slugSuffix}-${runId}`
  assert.ok(username.length <= 30, `Disposable hiring username is too long: ${username}`)
  await page.locator('input[name="slug"]').fill(username)
  await expect(page.getByText('Username is available.', { exact: true })).toBeVisible({ timeout: 10_000 })
  await page.getByLabel('Location', { exact: true }).fill('Mumbai')
  const completeButton = page.getByRole('button', { name: 'Complete profile' })
  await expect(completeButton).toBeEnabled()
  await completeButton.click()
  await page.waitForURL((url) => url.pathname === '/home', { timeout: 20_000 })
  await context.close()
}

async function submitOrganizationApplication() {
  assert.ok(organizationName)
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.applicant)
  // /hiring/organization now only redirects to /organizations; registration has its own page.
  await page.goto(`${siteUrl}/organizations/register`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 1, name: 'Register your organization', exact: true })).toBeVisible()
  const form = page.getByRole('form', { name: 'Register a new organization' })
  // The type comes first: it shows the fleet fields and renames the registration number for a shipowner.
  await form.getByLabel('Organization type', { exact: true }).selectOption('shipowner')
  await form.getByLabel('Organization name', { exact: true }).fill(organizationName)
  await form.getByLabel('Website').fill('https://example.com')
  await form.getByLabel('Official work email', { exact: true }).fill(users.applicant.email)
  await form.getByLabel('Office location', { exact: true }).fill('Mumbai, India')
  await form.getByLabel('Country', { exact: true }).selectOption('IN')
  await form.getByLabel('Description', { exact: true }).fill('Disposable maritime employer record created only for the guarded Sea N Shore staging hiring end-to-end verification.')
  await form.getByLabel('Number of vessels').fill('2')
  await form.getByLabel('Vessel types').fill('Oil Tanker, Chemical Tanker')
  await form.getByLabel('Fleet summary').fill('Two test-managed tanker vessels used only as structured staging verification data.')
  await form.getByLabel('Your role / relationship', { exact: true }).fill('Director')
  await form.getByLabel('Company registration or IMO company number').fill(`E2E-${runId}`)
  await form.getByLabel('Supporting notes').fill('Guarded staging E2E. This organization and all linked records must be deleted by workflow cleanup.')
  await form.getByRole('button', { name: 'Submit for verification' }).click()
  // The form's status line only says the action returned; the durable review state is read back from Organizations.
  await expect(form.getByRole('status')).toHaveText(/^Organization submitted\./, { timeout: 20_000 })
  await page.goto(`${siteUrl}/organizations`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Organization verification in progress', exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(`Sea N Shore is reviewing ${organizationName}.`, { exact: false })).toBeVisible()
  console.log('ORGANIZATION_HIRING_E2E_APPLICATION_SUBMITTED=true')
  await context.close()
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A date as YYYY-MM-DD in UTC, like the job lifecycle's "today". */
function isoDateFromToday(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Round 14: a platform administrator needs an authenticator app before any admin page opens or any admin decision
 * is accepted. The disposable admin turns one on the way a person would: the admin gate sends them to Settings →
 * Two-step verification, they type the setup key's current code, and the same password session then satisfies
 * the rule. The key is never printed; Cognito deletes it with the user at cleanup.
 */
async function enableAdminTwoStep(page) {
  await page.waitForURL((url) => url.pathname === '/settings/security' && url.searchParams.get('required') === 'admin', { timeout: 20_000 })
  const twoStep = page.locator('section[aria-labelledby="two-step-heading"]')
  await twoStep.getByRole('button', { name: 'Set up authenticator app' }).click()
  const setupKey = twoStep.getByLabel('Setup key', { exact: true })
  await expect(setupKey).toBeVisible({ timeout: 20_000 })
  const secret = (await setupKey.innerText()).replace(/\s+/g, '')
  await twoStep.getByLabel(/Enter the 6-digit code the app shows/).fill(await freshTotpCode(secret))
  await twoStep.getByRole('button', { name: 'Verify and turn on' }).click()
  const outcome = await Promise.race([
    page.waitForURL((url) => url.pathname.startsWith('/admin'), { timeout: 20_000 }).then(() => ({ kind: 'admin' })),
    twoStep.getByRole('status').waitFor({ state: 'visible', timeout: 20_000 }).then(() => ({ kind: 'enabled' })),
    twoStep.getByRole('alert').waitFor({ state: 'visible', timeout: 20_000 }).then(async () => ({ kind: 'error', text: (await twoStep.getByRole('alert').innerText()).trim() })),
  ]).catch(() => null)
  if (!outcome || outcome.kind === 'error') {
    throw new Error(`Disposable admin could not turn on two-step verification: ${outcome?.text ?? 'timeout'}`)
  }
  console.log('ORGANIZATION_HIRING_E2E_ADMIN_TWO_STEP_VERIFIED=true')
}

/** Admin → organization review → Manual access overrides: one recorded grant, read back after a reload. */
async function grantOrganizationEntitlement(page, capability) {
  const overrides = page.locator('section', { has: page.getByRole('heading', { name: 'Manual access overrides', exact: true }) })
  await overrides.getByLabel('Capability', { exact: true }).selectOption(capability)
  await overrides.getByLabel('Reason', { exact: true }).fill(`Disposable staging hiring E2E ${runId}: ${capability} for the test organization only.`)
  await overrides.getByRole('button', { name: 'Grant entitlement' }).click()
  await expect(overrides.getByRole('status')).toHaveText('Entitlement granted and recorded in the audit trail.', { timeout: 20_000 })
  await page.reload({ waitUntil: 'networkidle' })
  // An active grant can't be granted again: its option is disabled.
  await expect(overrides.getByLabel('Capability', { exact: true }).locator(`option[value="${capability}"]`)).toBeDisabled()
}

async function approveOrganization() {
  assert.match(applicationId ?? '', /^[0-9a-f-]{36}$/)
  assert.ok(organizationName)
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.admin)
  const reviewUrl = `${siteUrl}/admin/organizations/${applicationId}`
  await page.goto(reviewUrl, { waitUntil: 'networkidle' })
  if (new URL(page.url()).pathname === '/settings/security') {
    await enableAdminTwoStep(page)
    await page.goto(reviewUrl, { waitUntil: 'networkidle' })
  }
  assert.equal(new URL(page.url()).pathname, `/admin/organizations/${applicationId}`, `Admin review did not open: ${new URL(page.url()).pathname}`)
  await expect(page.getByRole('heading', { level: 2, name: organizationName, exact: true })).toBeVisible()
  // The header badge comes before the "Organization verification" detail, which says the same.
  await expect(page.getByText('Not verified', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Approve organization' }).click()
  await expect(page.getByText('Verified employer', { exact: true })).toBeVisible({ timeout: 20_000 })
  console.log('ORGANIZATION_HIRING_E2E_ADMIN_APPROVAL_UI_VERIFIED=true')

  // Verification alone does not let an organization publish jobs: that needs Organization Pro, or an admin grant.
  await grantOrganizationEntitlement(page, 'job.publish')
  await grantOrganizationEntitlement(page, 'job.manage_applicants')
  console.log('ORGANIZATION_HIRING_E2E_ADMIN_HIRING_GRANTS_UI_VERIFIED=true')
  await context.close()
}

async function postJobAsOwner() {
  assert.ok(jobTitle)
  assert.ok(organizationName)
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.applicant)
  await page.goto(`${siteUrl}/hiring`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Hiring', exact: true })).toBeVisible()
  await expect(page.getByText(`Ready · ${organizationName}`, { exact: true })).toBeVisible()
  await page.goto(`${siteUrl}/hiring/jobs/new`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Post a maritime job' })).toBeVisible()

  // The radio's name is its whole card: the organization's name first, then its kind and role.
  const publisher = page.getByRole('radio', { name: new RegExp(`^${escapeRegExp(organizationName)}`) })
  await expect(publisher).toBeEnabled()
  await publisher.check()
  await expect(publisher).toBeChecked()

  await page.getByLabel('Job title', { exact: true }).fill(jobTitle)
  await page.getByLabel('Department', { exact: true }).selectOption('deck_officers')
  await page.getByRole('group', { name: 'Accepted ranks / roles' }).getByRole('checkbox', { name: 'Chief Officer', exact: true }).check()
  const jobType = page.getByLabel('Job type', { exact: true })
  await expect(jobType).toHaveValue('sea')
  await expect(jobType).toBeDisabled()
  await page.getByLabel('Location', { exact: true }).fill('Worldwide')
  await page.getByLabel('Summary', { exact: true }).fill('Chief Officer required for a disposable staging tanker vacancy used to verify the complete hiring authorization flow.')
  await page.getByLabel('Description', { exact: true }).fill('Join an oil tanker for a guarded staging-only vacancy. This posting verifies verified-company authorization, structured maritime requirements and publication, then is deleted automatically.')
  await page.getByLabel('Vessel types', { exact: true }).fill('Oil Tanker, Chemical Tanker')
  await page.getByLabel('Minimum years', { exact: true }).fill('6')
  await page.getByLabel('Maximum years', { exact: true }).fill('12')
  await page.getByLabel('Sailing regions', { exact: true }).fill('Worldwide, Middle East')
  await page.getByLabel('Certificates', { exact: true }).fill('STCW, Advanced Oil Tanker')
  await page.getByLabel('Visa / documents note (optional)', { exact: true }).fill('US C1/D')
  await page.getByLabel('Other requirements', { exact: true }).fill('Valid medical and tanker sea service required for this staging-only test vacancy.')
  // A future date: the job must go live open. The expired state is made afterwards through SSM.
  await page.getByLabel('Last date to apply', { exact: true }).fill(isoDateFromToday(30))
  await page.getByLabel('Salary minimum', { exact: true }).fill('7000')
  await page.getByLabel('Salary maximum', { exact: true }).fill('8500')
  await page.getByLabel('Currency', { exact: true }).fill('USD')
  await page.getByLabel('Salary period', { exact: true }).selectOption('month')
  await page.getByLabel('Urgent joining', { exact: true }).check()
  // 0 turns the minimum match off, so the disposable candidate's Easy Apply never depends on match scoring.
  await page.getByLabel('Minimum match to apply').fill('0')

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

  const jobStatus = page.locator('form p[role="status"]')
  const jobIssues = page.locator('#hiring-job-issues')
  await page.getByRole('button', { name: 'Publish job', exact: true }).click()
  const outcome = await Promise.race([
    page.waitForURL((url) => url.pathname === '/hiring/jobs', { timeout: 20_000 }).then(() => ({ kind: 'navigated' })),
    jobIssues.waitFor({ state: 'visible', timeout: 20_000 }).then(async () => ({ kind: 'issues', text: (await jobIssues.innerText()).trim() })),
  ]).catch(() => null)

  if (outcome?.kind === 'issues') {
    const probe = runFailedJobProbe()
    throw new Error(`Job create action failed: issues=${JSON.stringify(outcome.text)} url=${page.url()} posts=${JSON.stringify(postObservations)} requestFailures=${JSON.stringify(requestFailures)} consoleErrors=${JSON.stringify(consoleErrors)} probe=${JSON.stringify(probe)}`)
  }
  if (new URL(page.url()).pathname !== '/hiring/jobs') {
    const statusText = await jobStatus.textContent().catch(() => null)
    const probe = runFailedJobProbe()
    throw new Error(`Job create navigation failed: outcome=${JSON.stringify(outcome)} status=${JSON.stringify(statusText?.trim() || null)} url=${page.url()} posts=${JSON.stringify(postObservations)} requestFailures=${JSON.stringify(requestFailures)} consoleErrors=${JSON.stringify(consoleErrors)} probe=${JSON.stringify(probe)}`)
  }

  await expect(page.getByRole('heading', { level: 1, name: 'Your jobs', exact: true })).toBeVisible()
  await expect(page.getByText(/^Your job is live: share it\./)).toBeVisible()
  await expect(ownerJobRow(page).getByText('Live', { exact: true }).filter({ visible: true })).toHaveCount(1)
  console.log('ORGANIZATION_HIRING_E2E_OWNER_JOB_UI_VERIFIED=true')
  await context.close()
}

/** The job's row on /hiring/jobs (the phone menu copy is hidden at this width). */
function ownerJobRow(page) {
  return page.locator('article').filter({ has: page.getByRole('heading', { level: 2, name: jobTitle, exact: true }) })
}

/** Discovery, newest first: plain SQL paging, so the ranked pool or "Applied" section never moves the job. */
function jobSearchUrl() {
  return `${siteUrl}/jobs?q=${encodeURIComponent(jobTitle)}&sort=recent`
}

async function verifyExpiredPublishedJobVisible() {
  assert.match(jobId ?? '', /^[0-9a-f-]{36}$/)
  assert.ok(jobTitle)
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.unauthorized)
  await page.goto(`${siteUrl}/jobs`, { waitUntil: 'networkidle' })
  // The phone toolbar's search form is in the DOM too, hidden at this width.
  await expect(page.locator('form[role="search"][action="/jobs"]').filter({ visible: true })).toHaveCount(1)
  await expect(page.getByPlaceholder('Position, rank, company or keyword')).toBeVisible()
  console.log('ORGANIZATION_HIRING_E2E_JOBS_DISCOVERY_RENDERED=true')

  // A published job past its apply-by date stays discoverable for members, but offers no way to apply.
  await page.goto(jobSearchUrl(), { waitUntil: 'networkidle' })
  const jobLink = page.getByRole('link', { name: jobTitle, exact: true })
  await expect(jobLink).toBeVisible()
  await expect(page.getByText('Applications closed', { exact: true }).filter({ visible: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Easy Apply' })).toHaveCount(0)

  await jobLink.click()
  await page.waitForURL((url) => url.pathname === `/jobs/${jobId}`, { timeout: 20_000 })
  await expect(page.getByText(/^Applications for this job closed on /).filter({ visible: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: /^(Easy Apply|Apply now)$/ })).toHaveCount(0)
  console.log('ORGANIZATION_HIRING_E2E_EXPIRED_PUBLISHED_VISIBLE=true')
  await context.close()
}

async function runLifecycleAction(page, action, confirmLabel, successText, prepare) {
  await page.getByRole('group', { name: `Manage ${jobTitle}` }).getByRole('button', { name: action, exact: true }).click()
  const confirmPanel = page.getByRole('region', { name: `${action} “${jobTitle}”?`, exact: true })
  await expect(confirmPanel).toBeVisible()
  if (prepare) await prepare(confirmPanel)
  await confirmPanel.getByRole('button', { name: confirmLabel, exact: true }).click()
  await expect(page.getByText(successText, { exact: true })).toBeVisible({ timeout: 20_000 })
}

async function archiveAndRepublishJob() {
  assert.match(jobId ?? '', /^[0-9a-f-]{36}$/)
  assert.ok(jobTitle)
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.applicant)
  const editUrl = `${siteUrl}/hiring/jobs/${jobId}/edit`
  const jobState = page.getByRole('region', { name: jobTitle, exact: true })

  await page.goto(editUrl, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Edit vacancy' })).toBeVisible()
  await expect(jobState.getByText('Applications closed', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Last date to apply', { exact: true })).not.toHaveValue('')

  // Archive: hidden from job search, still reviewable.
  await runLifecycleAction(page, 'Archive', 'Archive job', 'Job archived. It is hidden from job search; you can still review applicants.')
  await page.goto(`${siteUrl}/hiring/jobs`, { waitUntil: 'networkidle' })
  await expect(ownerJobRow(page).getByText('Archived', { exact: true }).filter({ visible: true })).toHaveCount(1)

  // Republish: the passed apply-by date is not carried over; "No closing date" keeps applications open.
  await page.goto(editUrl, { waitUntil: 'networkidle' })
  await expect(jobState.getByText('Archived', { exact: true })).toBeVisible()
  await runLifecycleAction(page, 'Republish', 'Republish job', 'Job republished. It is visible in job search again.', async (confirmPanel) => {
    await expect(confirmPanel.getByText(/^The previous apply-by date \(.+\) has passed\. Choose a new date or remove it\.$/)).toBeVisible()
    await expect(confirmPanel.getByLabel('Apply by', { exact: true })).toHaveValue('')
    await confirmPanel.getByLabel('No closing date', { exact: true }).check()
  })
  await page.goto(editUrl, { waitUntil: 'networkidle' })
  await expect(jobState.getByText('Live', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Last date to apply', { exact: true })).toHaveValue('')

  await page.goto(`${siteUrl}/hiring/jobs`, { waitUntil: 'networkidle' })
  await expect(ownerJobRow(page).getByText('Live', { exact: true }).filter({ visible: true })).toHaveCount(1)
  console.log('ORGANIZATION_HIRING_E2E_ARCHIVE_REPUBLISH_UI_VERIFIED=true')
  await context.close()
}

async function applyToPublishedJob() {
  assert.match(jobId ?? '', /^[0-9a-f-]{36}$/)
  assert.ok(jobTitle)
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.unauthorized)
  await page.goto(jobSearchUrl(), { waitUntil: 'networkidle' })
  const jobLink = page.getByRole('link', { name: jobTitle, exact: true })
  await expect(jobLink).toBeVisible()
  await expect(page.getByRole('button', { name: 'Easy Apply' })).toBeVisible()

  const postObservations = []
  const uploadObservations = []
  const requestFailures = []
  const consoleErrors = []
  const startedAt = Date.now()
  page.on('response', (response) => {
    const request = response.request()
    if (request.method() === 'POST' && response.url().startsWith(siteUrl)) {
      postObservations.push({ status: response.status(), url: response.url(), elapsedMs: Date.now() - startedAt })
    }
    if (request.method() === 'PUT') {
      uploadObservations.push({ status: response.status(), url: response.url(), elapsedMs: Date.now() - startedAt })
    }
  })
  page.on('requestfailed', (request) => {
    requestFailures.push({ method: request.method(), url: request.url(), failure: request.failure()?.errorText ?? 'unknown' })
  })
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 500))
  })

  await page.getByRole('button', { name: 'Easy Apply' }).click()
  const applyDialog = page.getByRole('dialog', { name: 'Apply for this job' })
  await expect(applyDialog).toBeVisible()

  const cvFileName = `e2e-cv-${runId}.pdf`
  await applyDialog.getByLabel('Attach CV (PDF)').setInputFiles({
    name: cvFileName,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'),
  })
  await expect(applyDialog.getByText(cvFileName, { exact: true })).toBeVisible()
  await applyDialog.getByRole('button', { name: 'Submit application' }).click()

  const applied = page.getByText('Applied', { exact: true }).first()
  const alert = applyDialog.getByRole('alert')
  const outcome = await Promise.race([
    applied.waitFor({ state: 'visible', timeout: 30_000 }).then(() => ({ kind: 'applied' })),
    alert.waitFor({ state: 'visible', timeout: 30_000 }).then(async () => ({ kind: 'error', text: (await alert.innerText()).trim() })),
  ]).catch(() => null)

  if (outcome?.kind !== 'applied') {
    throw new Error(`Job card Easy Apply with CV failed: outcome=${JSON.stringify(outcome)} url=${page.url()} posts=${JSON.stringify(postObservations)} uploads=${JSON.stringify(uploadObservations)} requestFailures=${JSON.stringify(requestFailures)} consoleErrors=${JSON.stringify(consoleErrors)}`)
  }
  assert.ok(uploadObservations.some((entry) => entry.status >= 200 && entry.status < 300), `Expected a successful CV PUT upload, got ${JSON.stringify(uploadObservations)}`)

  await jobLink.click()
  await page.waitForURL((url) => url.pathname === `/jobs/${jobId}`, { timeout: 20_000 })
  await expect(page.getByText('Application submitted', { exact: true }).first()).toBeVisible()

  // The phone list repeats each title, hidden at this width; getByRole sees only the visible link.
  await page.goto(`${siteUrl}/jobs/applications`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('link', { name: jobTitle, exact: true })).toBeVisible({ timeout: 20_000 })
  console.log('ORGANIZATION_HIRING_E2E_JOB_APPLICATION_UI_VERIFIED=true')
  await context.close()

  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  await signInCompleted(ownerPage, users.applicant)
  await ownerPage.goto(`${siteUrl}/hiring/jobs/${jobId}/applicants`, { waitUntil: 'networkidle' })
  await expect(ownerPage.getByRole('heading', { name: users.unauthorized.fullName, exact: true })).toBeVisible({ timeout: 20_000 })
  await ownerPage.getByRole('link', { name: 'Review application' }).click()
  await expect(ownerPage.getByText('Candidate CV', { exact: true })).toBeVisible()
  await expect(ownerPage.getByText(cvFileName, { exact: true })).toBeVisible()
  const cvLink = ownerPage.getByRole('link', { name: 'View CV (PDF)' })
  await expect(cvLink).toBeVisible()
  const cvHref = await cvLink.getAttribute('href')
  assert.ok(cvHref, 'Recruiter CV link must have an href')
  // The first-party CV route checks the signed-in hiring team on every request; the context sends its cookies.
  const cvResponse = await ownerContext.request.get(new URL(cvHref, siteUrl).href)
  assert.equal(cvResponse.status(), 200, `Expected the CV route to return 200, got ${cvResponse.status()}`)
  assert.match(cvResponse.headers()['content-type'] ?? '', /^application\/pdf(?:;|$)/i)
  console.log('ORGANIZATION_HIRING_E2E_CV_UPLOAD_REVIEW_VERIFIED=true')
  await ownerContext.close()
}

async function verifyUnauthorized() {
  assert.match(jobId ?? '', /^[0-9a-f-]{36}$/)
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.unauthorized)

  // The form renders for any member, but no identity of theirs can publish.
  await page.goto(`${siteUrl}/hiring/jobs/new`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Post a maritime job' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'To publish this job, you still need:', exact: true })).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(1)
  await expect(page.getByRole('radio', { disabled: false })).toHaveCount(0)
  await expect(page.getByText('Verification required', { exact: true })).toBeVisible()

  await page.goto(`${siteUrl}/hiring`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Hiring', exact: true })).toBeVisible()
  await expect(page.getByText('Publishing setup required', { exact: true })).toBeVisible()
  await expect(page.getByText(/^Ready · /)).toHaveCount(0)

  const crossCompanyResponse = await page.goto(`${siteUrl}/hiring/jobs/${jobId}/edit`, { waitUntil: 'networkidle' })
  assert.equal(crossCompanyResponse?.status(), 404, 'Unauthorized cross-company edit route must return 404')
  const crossCompanyApplicants = await page.goto(`${siteUrl}/hiring/jobs/${jobId}/applicants`, { waitUntil: 'networkidle' })
  assert.equal(crossCompanyApplicants?.status(), 404, 'Unauthorized cross-company applicants route must return 404')
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
  } else if (phase === 'candidate-expired-visibility') {
    await verifyExpiredPublishedJobVisible()
  } else if (phase === 'owner-republish') {
    await archiveAndRepublishJob()
  } else if (phase === 'candidate-apply') {
    await applyToPublishedJob()
  } else if (phase === 'unauthorized') {
    await verifyUnauthorized()
  }
} finally {
  await browser.close()
}
