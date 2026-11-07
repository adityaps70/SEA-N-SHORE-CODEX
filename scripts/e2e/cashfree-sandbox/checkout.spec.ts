// Cashfree sandbox checkout E2E: one signed-in member buys a course, an organization Pro plan and an event ticket
// through Cashfree's SANDBOX, on the app copy built with the Content Security Policy ENFORCED. Each checkout must end
// paid in the runner's database (the server's own confirmation with Cashfree), with no CSP violation on our pages.
import { readFileSync } from 'node:fs'
import { expect, test, type Frame, type Page } from '@playwright/test'
import pg from 'pg'

const fixtures = JSON.parse(readFileSync(process.env.SANDBOX_FIXTURES_PATH ?? '/tmp/cashfree-sandbox-fixtures.json', 'utf8')) as {
  memberId: string; courseSlug: string; courseId: string; eventId: string; companyId: string
}
const db = new pg.Pool({
  host: process.env.AURORA_HOST, port: Number(process.env.AURORA_PORT ?? 5432), database: process.env.AURORA_DATABASE,
  user: process.env.AURORA_USER, password: process.env.AURORA_PASSWORD, max: 2,
})
const one = async (text: string, values: unknown[]) => (await db.query(text, values)).rows[0] ?? null

// Cashfree's documented sandbox test methods: a UPI ID that always succeeds, and a test card.
const SANDBOX_UPI = 'testsuccess@gocash'
const SANDBOX_CARD = { number: '4111 1111 1111 1111', expiry: '12/30', cvv: '123', name: 'Sandbox Buyer' }
const SANDBOX_OTP = '111000'

type Violation = { directive: string; blocked: string; source: string; page: string }
let violations: Violation[] = []

test.beforeEach(async ({ context }) => {
  violations = []
  // Record every CSP violation on our own documents (the policy is enforced in this build).
  await context.exposeBinding('__recordCsp', ({ page }, v: Omit<Violation, 'page'>) => { violations.push({ ...v, page: page.url() }) })
  await context.addInitScript(() => {
    if (!location.origin.startsWith('http://127.0.0.1')) return
    document.addEventListener('securitypolicyviolation', (event) => {
      // @ts-expect-error exposed by the test
      window.__recordCsp({ directive: event.effectiveDirective, blocked: event.blockedURI, source: event.sourceFile })
    })
  })
})

test.afterAll(async () => { await db.end() })

async function signIn(page: Page) {
  await page.goto('/auth/sign-in')
  await page.locator('input[name="email"]').fill(process.env.E2E_MEMBER_EMAIL!)
  await page.locator('input[name="password"]').fill(process.env.E2E_MEMBER_PASSWORD!)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(/\/home(\?|$)/, { timeout: 60_000 })
}

async function visibleIn(scope: Page | Frame, locator: ReturnType<Page['locator']>) {
  try { return await locator.first().isVisible() } catch { return false }
}

/**
 * Drives whichever Cashfree sandbox screen is showing until `done()` reports the server confirmed the payment:
 * choose UPI (or card), enter the sandbox details, approve the sandbox simulator's success step.
 */
async function completeSandboxPayment(page: Page, done: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 6 * 60_000
  let step = 0
  while (Date.now() < deadline) {
    if (await done()) return
    const scopes: Array<Page | Frame> = [...page.context().pages().filter((p) => /cashfree\.com/.test(p.url())), ...page.frames().filter((f) => /cashfree\.com/.test(f.url()))]
    for (const scope of scopes) {
      const upiId = scope.locator('input[placeholder*="UPI" i], input[name*="vpa" i], input[placeholder*="@"]')
      if (await visibleIn(scope, upiId)) {
        await upiId.first().fill(SANDBOX_UPI)
        await scope.getByRole('button', { name: /verify|pay|proceed|continue/i }).first().click().catch(() => {})
        continue
      }
      const cardNumber = scope.locator('input[name*="card" i][name*="number" i], input[placeholder*="card number" i], input[autocomplete="cc-number"]')
      if (await visibleIn(scope, cardNumber)) {
        await cardNumber.first().fill(SANDBOX_CARD.number)
        await scope.locator('input[autocomplete="cc-exp"], input[placeholder*="MM" i]').first().fill(SANDBOX_CARD.expiry).catch(() => {})
        await scope.locator('input[autocomplete="cc-csc"], input[placeholder*="CVV" i]').first().fill(SANDBOX_CARD.cvv).catch(() => {})
        await scope.locator('input[autocomplete="cc-name"], input[placeholder*="name" i]').first().fill(SANDBOX_CARD.name).catch(() => {})
        await scope.getByRole('button', { name: /pay|proceed|continue/i }).first().click().catch(() => {})
        continue
      }
      const otp = scope.locator('input[name*="otp" i], input[placeholder*="OTP" i]')
      if (await visibleIn(scope, otp)) {
        await otp.first().fill(SANDBOX_OTP)
        await scope.getByRole('button', { name: /submit|verify|pay|continue/i }).first().click().catch(() => {})
        continue
      }
      // Sandbox simulators show an explicit success choice.
      const success = scope.getByRole('button', { name: /^(success|authori[sz]e|approve|simulate success)$/i })
      if (await visibleIn(scope, success)) { await success.first().click().catch(() => {}); continue }
      const upiTab = scope.getByText(/^UPI( ID)?$/i)
      if (await visibleIn(scope, upiTab)) { await upiTab.first().click().catch(() => {}); continue }
      const cardTab = scope.getByText(/^(Cards?|Debit\/Credit Card)$/i)
      if (await visibleIn(scope, cardTab)) { await cardTab.first().click().catch(() => {}); continue }
    }
    step += 1
    if (step % 15 === 0) await page.screenshot({ path: `/tmp/cashfree-sandbox-results/${label}-waiting-${step}.png` }).catch(() => {})
    await page.waitForTimeout(2_000)
  }
  throw new Error(`${label}: the sandbox payment was not confirmed within 6 minutes`)
}

function expectNoViolations() {
  for (const v of violations) console.log(`SANDBOX_CSP_VIOLATION directive=${v.directive} blocked=${v.blocked} source=${v.source} page=${new URL(v.page).pathname}`)
  expect(violations, 'no CSP violation on our pages with the policy enforced').toEqual([])
}

test('sign-in through the Cognito stand-in, with the CSP enforced', async ({ page }) => {
  const response = await page.goto('/auth/sign-in')
  expect(response?.headers()['content-security-policy'], 'this build sends the enforced policy').toBeTruthy()
  expect(response?.headers()['content-security-policy-report-only']).toBeUndefined()
  await signIn(page)
  // Signed in: the course page renders its purchase panel (without Cashfree keys it says purchases open soon).
  await page.goto(`/learn/courses/${fixtures.courseSlug}`)
  await expect(page.getByRole('heading', { name: 'Course access' })).toBeVisible()
  await page.goto(`/events/${fixtures.eventId}`)
  await expect(page.getByRole('heading', { name: 'Sandbox Checkout Event' })).toBeVisible()
  await page.goto(`/settings/billing/organizations/${fixtures.companyId}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expectNoViolations()
  console.log('SANDBOX_SIGN_IN_PASSED csp=enforced')
})

test('sandbox checkouts with the CSP enforced: course, organization Pro plan, event ticket', async ({ page }) => {
  test.skip(process.env.RUN_CHECKOUTS !== 'true', 'manual start only')
  expect(process.env.CASHFREE_ENVIRONMENT).toBe('sandbox')
  expect(process.env.CASHFREE_CLIENT_ID ?? '').toMatch(/^TEST/)
  await signIn(page)

  await test.step('course', async () => {
    await page.goto(`/learn/courses/${fixtures.courseSlug}#course-access`)
    await page.getByLabel('Billing state').selectOption('27')
    await page.getByRole('button', { name: /^Buy course/ }).click()
    await completeSandboxPayment(page, async () => Boolean(await one(
      `select 1 from public.course_payment_orders o join public.learning_enrollments e on e.payment_order_id = o.id
        where o.profile_id = $1 and o.course_id = $2 and o.status = 'paid' and o.provider = 'cashfree' and o.enrollment_confirmed_at is not null
          and e.status = 'active'`,
      [fixtures.memberId, fixtures.courseId],
    )), 'course')
    console.log('SANDBOX_CHECKOUT_PAID item=course')
  })

  await test.step('event ticket', async () => {
    await page.goto(`/events/${fixtures.eventId}`)
    await page.getByRole('button', { name: /^Pay .* and register$/ }).click()
    await completeSandboxPayment(page, async () => Boolean(await one(
      `select 1 from public.event_payment_orders o join public.event_attendees a on a.payment_order_id = o.id
        where o.event_id = $1 and o.profile_id = $2 and a.user_id = $2 and o.status = 'paid' and o.provider = 'cashfree' and o.registration_confirmed_at is not null`,
      [fixtures.eventId, fixtures.memberId],
    )), 'event')
    console.log('SANDBOX_CHECKOUT_PAID item=event_ticket')
  })

  await test.step('organization Pro plan', async () => {
    await page.goto(`/settings/billing/organizations/${fixtures.companyId}`)
    const popup = page.context().waitForEvent('page', { timeout: 60_000 }).catch(() => null)
    await page.getByRole('button', { name: /^Set up auto-pay/ }).click()
    const contactPhone = page.getByLabel('Mobile number')
    if (await contactPhone.isVisible().catch(() => false)) {
      await contactPhone.fill('9000000001')
      await page.getByRole('button', { name: /continue|set up auto-pay/i }).first().click()
    }
    await popup
    await completeSandboxPayment(page, async () => Boolean(await one(
      `select 1 from public.subscription_checkouts c join public.account_subscriptions s on s.provider_subscription_id = c.provider_subscription_id
        where c.company_id = $1 and c.plan_code = 'organization_pro' and c.status = 'active' and c.provider_environment = 'sandbox'
          and s.status = 'active' and s.billing_provider = 'cashfree'`,
      [fixtures.companyId],
    )), 'pro-plan')
    console.log('SANDBOX_CHECKOUT_PAID item=organization_pro')
  })

  expectNoViolations()
  console.log('SANDBOX_CHECKOUT_RESULT course=paid event_ticket=paid organization_pro=active csp_violations=0')
})
