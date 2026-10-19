import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * Round I (I3): the site as an iPhone 15 Home Screen app (display-mode standalone, navigator.standalone).
 *
 * Signed out (always runs): the app marker cookie is set, and Google sign-in offers the in-app code step with
 * "Continue with email". With E2E_USER_EMAIL and E2E_USER_PASSWORD: sign in, check the session cookies, then
 * "force-close" the app (a new browser context from the stored cookies, without the 60-minute access cookie, as
 * an hour later) and reopen it at "/": it opens signed in on the feed, and Active sessions lists the app.
 */
// The iPhone 15 viewport, user agent and touch, in whichever browser the project runs (Chromium in CI).
const iPhone15 = Object.fromEntries(Object.entries(devices['iPhone 15']).filter(([key]) => key !== 'defaultBrowserType'))
test.use(iPhone15)

const THIRTY_DAYS_S = 30 * 24 * 60 * 60

async function asHomeScreenApp(context: BrowserContext, page: Page, browserName: string) {
  await context.addInitScript(() => Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: true }))
  if (browserName === 'chromium') {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] })
  }
}

test('signed out in the Home Screen app: the app marker is set and Google offers the code step', async ({ context, page, browserName }) => {
  await asHomeScreenApp(context, page, browserName)
  await page.goto('/auth/sign-in')
  await expect.poll(async () => (await context.cookies()).find((cookie) => cookie.name === 'sns_display_mode')?.value).toBe('standalone')
  const marker = (await context.cookies()).find((cookie) => cookie.name === 'sns_display_mode')!
  expect(marker).toMatchObject({ path: '/', sameSite: 'Lax', httpOnly: false })

  const google = page.getByRole('link', { name: /Continue with Google/ }).first()
  test.skip(!(await google.isVisible()), 'Google sign-in is switched off on this server.')
  await google.click()
  const panel = page.getByRole('region', { name: 'Google sign-in in the Home Screen app' })
  await expect(panel).toBeVisible()
  await expect(panel.getByText(/Google opens in a separate Safari window/)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Continue with email' })).toBeVisible()
  await panel.getByRole('button', { name: 'Continue with email' }).click()
  await expect(page.getByLabel('Email')).toBeFocused()
})

test('signed in, force-closed and reopened an hour later, the Home Screen app is still signed in', async ({ browser, context, page, browserName }) => {
  const email = process.env.E2E_USER_EMAIL
  const password = process.env.E2E_USER_PASSWORD
  test.skip(!email || !password, 'Set E2E_USER_EMAIL and E2E_USER_PASSWORD to run the signed-in Home Screen app check.')

  await asHomeScreenApp(context, page, browserName)
  await page.goto('/auth/sign-in')
  await page.getByLabel('Email').fill(email as string)
  await page.getByLabel('Password').fill(password as string)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/(home|onboarding)(?:[/?]|$)/)

  const cookies = await context.cookies()
  const refresh = cookies.find((cookie) => cookie.name === 'sns_cognito_refresh')!
  const access = cookies.find((cookie) => cookie.name === 'sns_cognito_access')!
  for (const cookie of [refresh, access]) {
    expect(cookie, cookie.name).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' })
    // Persistent (Max-Age), not a session cookie that iOS drops when the app is closed.
    expect(cookie.expires, cookie.name).toBeGreaterThan(Date.now() / 1000)
  }
  expect(refresh.expires).toBeGreaterThan(Date.now() / 1000 + THIRTY_DAYS_S - 120)

  // Force-close: a new context with only the stored cookies, an hour later (the access cookie has expired).
  const stored = await context.storageState()
  const reopened = await browser.newContext({
    ...iPhone15,
    storageState: { ...stored, cookies: stored.cookies.filter((cookie) => cookie.name !== 'sns_cognito_access') },
  })
  const app = await reopened.newPage()
  await asHomeScreenApp(reopened, app, browserName)
  await app.goto('/')
  await expect(app).toHaveURL(/\/(home|onboarding)(?:[/?]|$)/)
  const renewed = (await reopened.cookies()).find((cookie) => cookie.name === 'sns_cognito_refresh')!
  expect(renewed.expires).toBeGreaterThanOrEqual(refresh.expires)

  await app.goto('/settings/account')
  await expect(app.getByText('Home Screen app on iPhone').first()).toBeVisible()
  await reopened.close()
})
