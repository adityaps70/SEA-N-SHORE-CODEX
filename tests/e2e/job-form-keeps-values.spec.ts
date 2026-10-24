import { expect, test, type Page } from '@playwright/test'

/**
 * Hotfix P2: the Post a job form never loses what was typed, at 390px and on desktop, keyboard only.
 * - Fill the whole form, leave two mistakes (description too short, salary maximum below the minimum) and Publish:
 *   every field keeps its value, "2 things to fix" links to both, focus is on the first, below the sticky header.
 *   Fixing both clears the errors one by one.
 * - Save draft with the same two mistakes saves, and the draft opens with both fields marked under
 *   "Before you publish".
 * - Save draft with only a title saves; Publish on that draft lists everything still needed.
 * - Restore after a reload brings the typed values back; Discard forgets them.
 *
 * Needs a signed-in member who can post jobs (E2E_ACCESS_COOKIE, or E2E_USER_EMAIL and E2E_USER_PASSWORD) and
 * E2E_JOB_FORM=1, because it saves real drafts (each is deleted at the end).
 */
const signedInConfigured = Boolean(process.env.E2E_ACCESS_COOKIE || (process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD))
const enabled = signedInConfigured && process.env.E2E_JOB_FORM === '1'
const LONG_DESCRIPTION = 'Full command of a product tanker on a nine-month contract, responsible for safe navigation, cargo operations and the crew.'

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

/** Moves focus with Tab only until it reaches the element. */
async function tabTo(page: Page, selector: string) {
  for (let step = 0; step < 150; step += 1) {
    if (await page.evaluate((target) => document.activeElement?.matches(target) ?? false, selector)) return
    await page.keyboard.press('Tab')
  }
  throw new Error(`Tab never reached ${selector}`)
}

async function typeInto(page: Page, selector: string, text: string) {
  await tabTo(page, selector)
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(text)
}

const typed: Record<string, string> = {
  title: 'E2E hotfix P2 Master', location: 'Singapore', summary: 'Command a product tanker.', description: 'Full command.',
  vesselTypes: 'Oil Tanker', experienceMinYears: '12', experienceMaxYears: '20', regions: 'Worldwide', certificates: 'STCW',
  visas: 'US C1/D', requirements: 'Tanker command experience.', salaryMin: '15000', salaryMax: '12000', salaryCurrency: 'EUR',
}

async function fillEverything(page: Page) {
  await page.keyboard.press('Tab')
  await typeInto(page, '[name=title]', typed.title!)
  await tabTo(page, '[name=departmentKey]')
  await page.keyboard.type('Deck')
  await tabTo(page, '[name=acceptedRoleKeys][value=master]')
  await page.keyboard.press('Space')
  for (const name of ['location', 'summary', 'description', 'vesselTypes', 'experienceMinYears', 'experienceMaxYears', 'regions', 'certificates', 'visas', 'requirements']) {
    await typeInto(page, `[name=${name}]`, typed[name]!)
  }
  await tabTo(page, '[name=joiningFrom]')
  await page.keyboard.type('01152099')
  for (const name of ['salaryMin', 'salaryMax', 'salaryCurrency']) await typeInto(page, `[name=${name}]`, typed[name]!)
  await tabTo(page, '[name=urgent]')
  await page.keyboard.press('Space')
}

async function expectEverythingKept(page: Page, overrides: Record<string, string> = {}) {
  for (const [name, value] of Object.entries({ ...typed, ...overrides })) {
    await expect(page.locator(`[name="${name}"]:not([type=hidden])`), name).toHaveValue(value)
  }
  await expect(page.locator('[name=departmentKey]')).toHaveValue('deck_officers')
  await expect(page.locator('[name=acceptedRoleKeys][value=master]')).toBeChecked()
  await expect(page.locator('[name=joiningFrom]')).toHaveValue('2099-01-15')
  await expect(page.locator('[name=urgent]')).toBeChecked()
}

async function expectFocusBelowHeader(page: Page, name: string) {
  await expect(page.locator(`[name="${name}"]:not([type=hidden])`)).toBeFocused()
  await expect.poll(() => page.evaluate(() => {
    const rect = document.activeElement!.getBoundingClientRect()
    const covers = [...document.querySelectorAll('header, [data-app-header]')]
      .map((element) => element.getBoundingClientRect())
      .filter((box) => box.height > 0 && box.top <= 0)
      .reduce((bottom, box) => Math.max(bottom, box.bottom), 0)
    return rect.top >= covers && rect.bottom <= window.innerHeight
  })).toBe(true)
}

async function deleteDraft(page: Page, title: string) {
  const group = page.getByRole('group', { name: `Manage ${title}` })
  await group.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Delete job' }).click()
  await expect(page).toHaveURL(/\/hiring\/jobs\?notice=deleted/)
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test.describe(`job form keeps what was typed at ${viewport.width}px (hotfix P2)`, () => {
    test.skip(!enabled, 'Set E2E_JOB_FORM=1 with a signed-in member who can post jobs.')
    test.use({ viewport })

    test('errors keep every value, link to each field and clear as they are fixed; Save draft saves with mistakes', async ({ page, baseURL }) => {
      await signIn(page, baseURL ?? 'http://127.0.0.1:3000')
      await page.goto('/hiring/jobs/new')
      await page.evaluate(() => { try { window.localStorage.clear() } catch {} })
      await page.reload()
      await fillEverything(page)

      await tabTo(page, 'button[value=publish]')
      await page.keyboard.press('Enter')
      const summary = page.locator('#hiring-job-issues')
      await expect(summary).toContainText(/^2 things to fix/)
      await expectEverythingKept(page)
      await expectFocusBelowHeader(page, 'description')
      await expect(summary.getByRole('link')).toHaveText(['Description', 'Salary maximum'])

      await summary.getByRole('link', { name: 'Salary maximum' }).focus()
      await page.keyboard.press('Enter')
      await expectFocusBelowHeader(page, 'salaryMax')
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type('18000')
      await expect(summary).toContainText(/^1 thing to fix/)
      await page.locator('[name=salaryMax]').fill('12000')

      // Save draft with both mistakes still there: it saves, and the draft opens with them marked.
      await tabTo(page, 'button[value=save]')
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/hiring\/jobs\/[0-9a-f-]+\/edit\?notice=draft/)
      await expect(page.locator('#hiring-job-checklist')).toContainText('Before you publish: 2 things to fix')
      await expectEverythingKept(page)
      await expect(page.locator('[name=description]')).toHaveAttribute('aria-invalid', 'true')
      await expect(page.locator('[name=salaryMax]')).toHaveAttribute('aria-invalid', 'true')
      await expectFocusBelowHeader(page, 'description')

      // Fixing both clears the checklist. The test saves rather than publishes, so no real job goes live.
      await typeInto(page, '[name=description]', LONG_DESCRIPTION)
      await typeInto(page, '[name=salaryMax]', '18000')
      await expect(page.locator('#hiring-job-checklist')).toHaveCount(0)
      await tabTo(page, 'button[value=save]')
      await page.keyboard.press('Enter')
      await expect(page.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible()
      await deleteDraft(page, typed.title!)
    })

    test('a title is enough for a draft; Publish on it lists the rest; Restore and Discard', async ({ page, baseURL }) => {
      await signIn(page, baseURL ?? 'http://127.0.0.1:3000')
      await page.goto('/hiring/jobs/new')
      await page.evaluate(() => { try { window.localStorage.clear() } catch {} })
      await page.reload()

      // Restore after a reload, then Discard.
      await page.keyboard.press('Tab')
      await typeInto(page, '[name=location]', 'Rotterdam')
      await page.keyboard.press('Tab')
      page.once('dialog', (dialog) => dialog.accept())
      await page.reload()
      await expect(page.getByText(/^Restore your unsaved job from /)).toBeVisible()
      await expect(page.locator('[name=location]')).toHaveValue('')
      await page.getByRole('button', { name: 'Restore' }).focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('[name=location]')).toHaveValue('Rotterdam')
      page.once('dialog', (dialog) => dialog.accept())
      await page.reload()
      await page.getByRole('button', { name: 'Discard' }).focus()
      await page.keyboard.press('Enter')
      await expect(page.getByText(/^Restore your unsaved job/)).toHaveCount(0)
      await expect(page.locator('[name=location]')).toHaveValue('')

      const title = 'E2E hotfix P2 title only'
      await page.keyboard.press('Tab')
      await typeInto(page, '[name=title]', title)
      await tabTo(page, 'button[value=save]')
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/hiring\/jobs\/[0-9a-f-]+\/edit\?notice=draft/)
      await expect(page.locator('#hiring-job-checklist')).toContainText(/Before you publish: \d+ things to fix/)
      await expect(page.locator('[name=title]')).toHaveValue(title)

      await tabTo(page, 'button[value=publish]')
      await page.keyboard.press('Enter')
      await expect(page.locator('#hiring-job-issues')).toContainText(/^\d+ things to fix/)
      await expect(page.locator('#hiring-job-issues').getByRole('link', { name: 'Summary' })).toBeVisible()
      await expect(page.locator('#hiring-job-issues').getByRole('link', { name: 'Description' })).toBeVisible()
      await deleteDraft(page, title)
    })
  })
}
