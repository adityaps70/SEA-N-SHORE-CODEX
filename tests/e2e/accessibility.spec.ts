import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * Round H (H8): an axe-core scan (WCAG 2.0 and 2.1, levels A and AA) of the key pages, which must have no serious
 * or critical violations.
 *
 * Visitors: the landing page, Jobs, a job, Learn and a course run without credentials. Members: Home, Jobs, a job,
 * Messages, Learn, a course and Settings need E2E_ACCESS_COOKIE, or E2E_USER_EMAIL and E2E_USER_PASSWORD. A job
 * and a course are found from their index pages, or set E2E_JOB_ID and E2E_COURSE_SLUG.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const BLOCKING = new Set(['serious', 'critical'])

type Target = { name: string; path: (page: Page) => Promise<string | null> }

const fixed = (path: string) => async () => path

async function firstLink(page: Page, index: string, pattern: RegExp, override?: string) {
  if (override) return override
  await page.goto(index)
  const hrefs = await page.locator('a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
  return hrefs.find((href) => pattern.test(href)) ?? null
}

const jobDetail = (page: Page) =>
  firstLink(page, '/jobs', /^\/jobs\/[0-9a-f-]{36}$/, process.env.E2E_JOB_ID ? `/jobs/${process.env.E2E_JOB_ID}` : undefined)
const course = (page: Page) =>
  firstLink(page, '/learn', /^\/learn\/courses\/[a-z0-9-]+$/, process.env.E2E_COURSE_SLUG ? `/learn/courses/${process.env.E2E_COURSE_SLUG}` : undefined)

const VISITOR_PAGES: Target[] = [
  { name: 'Landing', path: fixed('/') },
  { name: 'Jobs', path: fixed('/jobs') },
  { name: 'Job detail', path: jobDetail },
  { name: 'Learn', path: fixed('/learn') },
  { name: 'Course', path: course },
]

const MEMBER_PAGES: Target[] = [
  { name: 'Home', path: fixed('/home') },
  { name: 'Jobs', path: fixed('/jobs') },
  { name: 'Job detail', path: jobDetail },
  { name: 'Messages', path: fixed('/messages') },
  { name: 'Learn', path: fixed('/learn') },
  { name: 'Course', path: course },
  { name: 'Settings', path: fixed('/settings') },
]

async function signIn(page: Page, baseURL: string) {
  const cookie = process.env.E2E_ACCESS_COOKIE
  if (cookie) {
    await page.context().addCookies([{ name: 'sns_cognito_access', value: cookie, url: baseURL }])
    return
  }
  await page.goto('/auth/sign-in')
  await page.getByLabel('Email').fill(process.env.E2E_USER_EMAIL as string)
  await page.getByLabel('Password').fill(process.env.E2E_USER_PASSWORD as string)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/home(?:\?|$)/)
}

const signedInConfigured = Boolean(process.env.E2E_ACCESS_COOKIE || (process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD))

/** Scans the open page and fails with a readable list of every serious or critical violation. */
async function expectNoSeriousViolations(page: Page) {
  await page.waitForLoadState('load')
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const blocking = results.violations
    .filter((violation) => BLOCKING.has(violation.impact ?? ''))
    .map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
    }))
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([])
}

async function checkPage(page: Page, target: Target) {
  const path = await target.path(page)
  test.skip(!path, `No ${target.name} page to open.`)
  await page.goto(path!)
  await expectNoSeriousViolations(page)
}

test.describe('visitors', () => {
  for (const target of VISITOR_PAGES) {
    test(`${target.name}: no serious or critical axe violations`, async ({ page }) => {
      await checkPage(page, target)
    })
  }
})

test.describe('members', () => {
  test.skip(!signedInConfigured, 'Set E2E_ACCESS_COOKIE, or E2E_USER_EMAIL and E2E_USER_PASSWORD.')

  for (const target of MEMBER_PAGES) {
    test(`${target.name}: no serious or critical axe violations`, async ({ page, baseURL }) => {
      await signIn(page, baseURL ?? 'http://127.0.0.1:3000')
      await checkPage(page, target)
    })
  }

  test('Home: "Skip to content" is the first stop and moves focus to the main content', async ({ page, baseURL }) => {
    await signIn(page, baseURL ?? 'http://127.0.0.1:3000')
    await page.goto('/home')
    await page.waitForLoadState('load')
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to content' })
    await expect(skip).toBeFocused()
    await expect(skip).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.locator('main#main-content')).toBeFocused()
    await expect(page.locator('main')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1, name: 'Home feed' })).toHaveCount(1)
  })
})
