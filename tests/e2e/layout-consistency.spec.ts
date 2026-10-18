import { expect, test, type Page } from '@playwright/test'

/**
 * Round H (H6): one consistent layout. On each key page, the header, the footer and the content width are the
 * expected ones, signed out and signed in, and the Messaging dock never covers the footer.
 *
 * - Headers: members always get the app header; visitors get the public header (the landing page draws its own).
 * - Footers: exactly one visible "Site footer" landmark: the rail footer on rail pages, the full footer elsewhere.
 * - Widths: the page's content box is one of the two shared widths (wide 80rem, narrow 56rem).
 *
 * Desktop only (the phone shell has no full footer for members and both widths exceed the screen). The signed-in
 * checks need E2E_ACCESS_COOKIE, or E2E_USER_EMAIL and E2E_USER_PASSWORD. Pages that need an id (a job, an
 * organization, a community) are found from their index page, or set E2E_JOB_ID, E2E_ORG_SLUG, E2E_COMMUNITY_SLUG.
 */
const WIDE = 1280
const NARROW = 896

type Expectation = {
  name: string
  path: (page: Page) => Promise<string | null>
  width: typeof WIDE | typeof NARROW | null
  footer: 'site' | 'rail'
}

const fixed = (path: string) => async () => path

async function firstLink(page: Page, index: string, pattern: RegExp, override?: string) {
  if (override) return override
  await page.goto(index)
  const hrefs = await page.locator('a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
  return hrefs.find((href) => pattern.test(href)) ?? null
}

const jobDetail = (page: Page) =>
  firstLink(page, '/jobs', /^\/jobs\/[0-9a-f-]{36}$/, process.env.E2E_JOB_ID ? `/jobs/${process.env.E2E_JOB_ID}` : undefined)
const organization = (page: Page) =>
  firstLink(page, '/organizations', /^\/organizations\/[a-z0-9-]+$/, process.env.E2E_ORG_SLUG ? `/organizations/${process.env.E2E_ORG_SLUG}` : undefined)
const community = (page: Page) =>
  firstLink(page, '/community', /^\/community\/[a-z0-9-]+$/, process.env.E2E_COMMUNITY_SLUG ? `/community/${process.env.E2E_COMMUNITY_SLUG}` : undefined)

const MEMBER_PAGES: Expectation[] = [
  { name: 'Home', path: fixed('/home'), width: WIDE, footer: 'rail' },
  { name: 'Jobs', path: fixed('/jobs'), width: WIDE, footer: 'site' },
  { name: 'Job detail', path: jobDetail, width: WIDE, footer: 'rail' },
  { name: 'Learn', path: fixed('/learn'), width: WIDE, footer: 'site' },
  { name: 'Events', path: fixed('/events'), width: WIDE, footer: 'site' },
  { name: 'Organization', path: organization, width: WIDE, footer: 'site' },
  { name: 'Community', path: community, width: WIDE, footer: 'site' },
  { name: 'Settings', path: fixed('/settings'), width: NARROW, footer: 'site' },
  { name: 'About', path: fixed('/about'), width: NARROW, footer: 'site' },
  { name: 'Pricing', path: fixed('/pricing'), width: WIDE, footer: 'site' },
]

// Events, organizations, communities and Settings need a member; visitors are sent to sign in.
const VISITOR_PAGES: Expectation[] = [
  { name: 'Landing', path: fixed('/'), width: null, footer: 'site' },
  { name: 'Jobs', path: fixed('/jobs'), width: WIDE, footer: 'site' },
  { name: 'Job detail', path: jobDetail, width: WIDE, footer: 'rail' },
  { name: 'Learn', path: fixed('/learn'), width: WIDE, footer: 'site' },
  { name: 'About', path: fixed('/about'), width: NARROW, footer: 'site' },
  { name: 'Pricing', path: fixed('/pricing'), width: WIDE, footer: 'site' },
]

/**
 * The page's content width: the innermost box (outside the header and footer) whose max-width is wider than a
 * reading measure (860px or more). Narrower boxes are text measures, dialogs and cards, not the page width.
 */
async function contentWidth(page: Page) {
  return page.evaluate(() => {
    let found: number | null = null
    let depth = -1
    const walk = (element: Element, level: number) => {
      if (element.matches('header, footer, nav, [data-app-header], [data-testid="messaging-dock-anchor"]')) return
      const maxWidth = Number.parseFloat(getComputedStyle(element).maxWidth)
      if (Number.isFinite(maxWidth) && maxWidth >= 860 && level > depth) {
        found = maxWidth
        depth = level
      }
      for (const child of Array.from(element.children)) walk(child, level + 1)
    }
    walk(document.body, 0)
    return found
  })
}

async function visibleFooters(page: Page) {
  const footers = page.locator('footer[aria-label="Site footer"]')
  const kinds: string[] = []
  for (let index = 0; index < (await footers.count()); index += 1) {
    const footer = footers.nth(index)
    if (!(await footer.isVisible())) continue
    kinds.push((await footer.getAttribute('data-rail-footer')) ? 'rail' : 'site')
  }
  return kinds
}

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

test.skip(({ isMobile }) => isMobile, 'The layout check runs at desktop width.')

test.describe('visitors', () => {
  for (const expectation of VISITOR_PAGES) {
    test(`${expectation.name}: public header, one ${expectation.footer} footer${expectation.width ? `, ${expectation.width}px content` : ''}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      const path = await expectation.path(page)
      test.skip(!path, `No ${expectation.name} page to open.`)
      await page.goto(path!)
      await page.waitForLoadState('load')

      await expect(page.locator('[data-app-header]')).toHaveCount(0)
      if (path === '/') {
        // The landing page keeps its own design header.
        await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
      } else {
        await expect(page.getByRole('navigation', { name: 'Public navigation' })).toBeVisible()
      }
      expect(await visibleFooters(page)).toEqual([expectation.footer])
      if (expectation.width) expect(await contentWidth(page)).toBe(expectation.width)
    })
  }
})

test.describe('members', () => {
  test.skip(!signedInConfigured, 'Set E2E_ACCESS_COOKIE, or E2E_USER_EMAIL and E2E_USER_PASSWORD.')

  for (const expectation of MEMBER_PAGES) {
    test(`${expectation.name}: app header, one ${expectation.footer} footer, ${expectation.width}px content`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await signIn(page, baseURL ?? 'http://127.0.0.1:3000')
      const path = await expectation.path(page)
      test.skip(!path, `No ${expectation.name} page to open.`)
      await page.goto(path!)
      await page.waitForLoadState('load')

      await expect(page.locator('[data-app-header]')).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Public navigation' })).toHaveCount(0)
      expect(await visibleFooters(page)).toEqual([expectation.footer])
      expect(await contentWidth(page)).toBe(expectation.width)
    })
  }

  for (const path of ['/settings', '/about', '/pricing']) {
    test(`${path}: the Messaging dock never covers the footer`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await signIn(page, baseURL ?? 'http://127.0.0.1:3000')
      await page.goto(path)
      await page.waitForLoadState('load')
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

      const dock = page.locator('[data-dock-state]')
      await expect(dock).toBeVisible()
      const bottomLine = page.locator('footer[data-app-footer="site"] p').last()
      await expect(bottomLine).toBeVisible()
      await expect(async () => {
        const dockBox = await dock.boundingBox()
        const lineBox = await bottomLine.boundingBox()
        expect(dockBox && lineBox).toBeTruthy()
        // The footer's last line ends above the dock bar.
        expect(lineBox!.y + lineBox!.height).toBeLessThanOrEqual(dockBox!.y + 1)
      }).toPass({ timeout: 10_000 })
    })
  }
})
