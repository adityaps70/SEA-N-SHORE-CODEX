import { expect, test, type Page } from '@playwright/test'

/**
 * Round F (F4): the right-rail footer is part of the rail's flow. Opening "More" must push content
 * down, never draw the link list over a rail card.
 *
 * Sign in with E2E_USER_EMAIL / E2E_USER_PASSWORD, or set E2E_ACCESS_COOKIE to an access-token cookie
 * value (local fake-Cognito harness: `local-learner`).
 */

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

function intersects(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

// The right rail shows on desktop only, so the phone project skips this file before opening a browser.
test.skip(({ isMobile }) => isMobile, 'The right rail shows on desktop only.')
test.skip(
  !process.env.E2E_ACCESS_COOKIE && !(process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD),
  'Set E2E_ACCESS_COOKIE, or E2E_USER_EMAIL and E2E_USER_PASSWORD, to run the rail footer check.',
)

for (const width of [1280, 1440, 1920]) {
  test(`home rail footer "More" opens below the rail cards at ${width}px`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height: 900 })
    await signIn(page, baseURL ?? 'http://127.0.0.1:3000')
    await page.goto('/home')

    const footer = page.locator('footer[data-rail-footer="xl"]')
    await expect(footer).toBeVisible()
    const more = footer.getByRole('button', { name: 'More' })
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    // The button works once the page has hydrated; retry the click until it does.
    await expect(async () => {
      if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click()
      await expect(more).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 })
    }).toPass({ timeout: 30_000 })
    await expect(footer.getByRole('link', { name: 'About' })).toBeVisible()

    const footerBox = await footer.boundingBox()
    expect(footerBox).not.toBeNull()
    const rail = footer.locator('xpath=..')
    const cards = rail.locator(':scope > :not(footer), :scope > :not(footer) > *')
    const count = await cards.count()
    expect(count).toBeGreaterThan(0)
    for (let index = 0; index < count; index += 1) {
      const card = await cards.nth(index).boundingBox()
      if (!card || !card.height) continue
      expect(intersects(footerBox!, card), `footer overlaps rail item ${index}`).toBe(false)
    }

    await page.keyboard.press('Escape')
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await expect(more).toBeFocused()
  })
}
