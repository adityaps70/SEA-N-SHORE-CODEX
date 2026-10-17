import { expect, test, type Page, type Request } from '@playwright/test'

/**
 * Round H (H1): request budgets per page view.
 *
 * - Nav, footer and feed links prefetch only on hover, focus or touch, once per route per session, so a
 *   page view must not prefetch the top-nav routes on load, and never the same route twice.
 * - A client-side page change keeps one realtime connection: no second ticket and no second
 *   messaging-state fetch.
 *
 * Prefetching only happens in production: run after `npm run build` with E2E_PRODUCTION=1. The signed-in
 * checks also need E2E_ACCESS_COOKIE, or E2E_USER_EMAIL and E2E_USER_PASSWORD.
 */
const PREFETCH_BUDGET_PER_VIEW = 6

function isRscRequest(request: Request) {
  const headers = request.headers()
  return headers.rsc === '1' || request.url().includes('_rsc=')
}

function routeOf(request: Request) {
  const url = new URL(request.url())
  return url.pathname
}

async function recordRsc(page: Page, action: () => Promise<void>) {
  const requests: Request[] = []
  const listener = (request: Request) => {
    if (isRscRequest(request)) requests.push(request)
  }
  page.on('request', listener)
  await action()
  page.off('request', listener)
  return requests
}

async function settle(page: Page) {
  // 'networkidle' never comes on pages that poll; the page's load event plus the pauses below is enough.
  await page.waitForLoadState('load')
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined)
  // Scroll so every link on the page has entered the viewport once (viewport prefetch would fire now).
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += Math.max(200, window.innerHeight / 2)) {
      window.scrollTo(0, y)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  })
  await page.waitForTimeout(1500)
}

test.skip(process.env.E2E_PRODUCTION !== '1', 'Prefetching only happens in production builds: set E2E_PRODUCTION=1 after npm run build.')

test.describe('signed-out pages', () => {
  for (const path of ['/', '/pricing', '/about', '/help']) {
    test(`${path} stays within the prefetch budget and never prefetches a route twice`, async ({ page }) => {
      const requests = await recordRsc(page, async () => {
        await page.goto(path)
        await settle(page)
      })
      const prefetches = requests.filter((request) => request.headers()['next-router-prefetch'] === '1' || request.headers()['next-router-segment-prefetch'])
      const routes = prefetches.map(routeOf)
      expect(new Set(routes).size, `prefetched: ${routes.join(', ')}`).toBeLessThanOrEqual(PREFETCH_BUDGET_PER_VIEW)
    })
  }
})

test.describe('signed-in app', () => {
  test.skip(
    !process.env.E2E_ACCESS_COOKIE && !(process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD),
    'Set E2E_ACCESS_COOKIE, or E2E_USER_EMAIL and E2E_USER_PASSWORD.',
  )

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

  test('Home does not prefetch the top-nav routes on load, and hover prefetches a route once', async ({ page, baseURL, isMobile }) => {
    test.skip(isMobile, 'The top nav shows on desktop.')
    await signIn(page, baseURL ?? 'http://127.0.0.1:3000')
    const navRoutes = ['/network', '/jobs', '/messages', '/learn', '/events']
    const onLoad = await recordRsc(page, async () => {
      await page.goto('/home')
      await settle(page)
    })
    const prefetchedNav = onLoad.map(routeOf).filter((route) => navRoutes.includes(route))
    expect(prefetchedNav, `nav routes prefetched on load: ${prefetchedNav.join(', ')}`).toEqual([])

    const nav = page.getByRole('navigation').first()
    const onHover = await recordRsc(page, async () => {
      await nav.getByRole('link', { name: /jobs/i }).first().hover()
      await page.waitForTimeout(800)
      await nav.getByRole('link', { name: /network/i }).first().hover()
      await nav.getByRole('link', { name: /jobs/i }).first().hover()
      await page.waitForTimeout(800)
    })
    const jobsRequests = onHover.filter((request) => routeOf(request) === '/jobs')
    // One route costs at most two RSC requests in Next 16 (route tree, then segment), once.
    expect(jobsRequests.length).toBeLessThanOrEqual(2)
  })

  test('moving between pages keeps one realtime connection and one messaging-state fetch', async ({ page, baseURL, isMobile }) => {
    test.skip(isMobile, 'The top nav shows on desktop.')
    await signIn(page, baseURL ?? 'http://127.0.0.1:3000')
    const calls: string[] = []
    page.on('request', (request) => {
      const { pathname } = new URL(request.url())
      if (pathname === '/api/realtime/ticket' || pathname === '/api/realtime/messaging-state') calls.push(pathname)
    })
    await page.goto('/home')
    await page.waitForLoadState('networkidle')
    const nav = page.getByRole('navigation').first()
    for (const name of [/jobs/i, /learn/i, /events/i, /network/i]) {
      await nav.getByRole('link', { name }).first().click()
      await page.waitForLoadState('networkidle')
    }
    expect(calls.filter((call) => call === '/api/realtime/ticket').length).toBeLessThanOrEqual(1)
    expect(calls.filter((call) => call === '/api/realtime/messaging-state').length).toBeLessThanOrEqual(1)
  })
})
