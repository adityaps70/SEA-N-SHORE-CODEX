import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * S2: the SCORM player fills the screen (Edmingle-style). At 1440×900 and 390×844, on a real SCORM lesson:
 * - the package frame is entirely inside the viewport, at least 520px tall, and the page does not scroll;
 * - nothing covers the frame (the lesson bar, the header, a tooltip): elementFromPoint at its corners and centre
 *   returns the frame itself;
 * - Focus mode lays the same frame (not reloaded) over the whole window, and Esc leaves it, from the page or
 *   from inside the package;
 * - completion still unlocks "Complete & next".
 *
 * Needs a signed-in member (E2E_ACCESS_COOKIE, or E2E_USER_EMAIL and E2E_USER_PASSWORD) and a SCORM lesson the
 * member is enrolled in: E2E_SCORM_LESSON_PATH=/learn/courses/<slug>/learn?lesson=<lesson id>. When the lesson has
 * not been started, the spec starts an attempt (use a lesson without an attempt limit). Completing the lesson writes
 * real progress, so that step runs only with E2E_SCORM_COMPLETE=1 (or when the lesson is already complete).
 */
const lessonPath = process.env.E2E_SCORM_LESSON_PATH
const signedInConfigured = Boolean(process.env.E2E_ACCESS_COOKIE || (process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD))
const FRAME_MIN_HEIGHT = 520

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

/** Opens the lesson (starting an attempt when needed) and waits until the frame has been fitted to the window. */
async function openLesson(page: Page, baseURL: string | undefined) {
  await signIn(page, baseURL ?? 'http://127.0.0.1:3000')
  await page.goto(lessonPath!)
  await page.waitForLoadState('load')
  const frame = page.locator('iframe[title="SCORM learning material"]')
  const start = page.getByRole('button', { name: 'Start SCORM material' })
  await expect(frame.or(start).first()).toBeVisible()
  if (await start.isVisible()) await start.click()
  await expect(frame).toBeVisible()
  await expect.poll(() => frame.evaluate((element) => (element as HTMLElement).style.getPropertyValue('--scorm-chrome'))).not.toBe('')
  return frame
}

/** What sits on top at the frame's four corners (2px in) and its centre: "frame" when nothing covers it. */
async function topmostAtFrame(frame: Locator) {
  return frame.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const points: Array<[number, number]> = [
      [box.left + 2, box.top + 2],
      [box.right - 3, box.top + 2],
      [box.left + 2, box.bottom - 3],
      [box.right - 3, box.bottom - 3],
      [box.left + box.width / 2, box.top + box.height / 2],
    ]
    return points.map(([x, y]) => {
      const hit = document.elementFromPoint(x, y)
      return hit === element ? 'frame' : hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}` : 'nothing'
    })
  })
}

test.skip(({ browserName }) => browserName !== 'chromium', 'Runs in Chromium, at the desktop and the phone size.')
test.skip(!signedInConfigured || !lessonPath, 'Set E2E_SCORM_LESSON_PATH and E2E_ACCESS_COOKIE (or E2E_USER_EMAIL and E2E_USER_PASSWORD).')

const SIZES = [
  { name: 'desktop 1440×900', viewport: { width: 1440, height: 900 }, phone: false },
  { name: 'phone 390×844', viewport: { width: 390, height: 844 }, phone: true },
]

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport, isMobile: size.phone, hasTouch: size.phone })

    test('the frame fills the window: fully inside it, the page does not scroll, nothing covers the frame', async ({ page, baseURL }) => {
      const frame = await openLesson(page, baseURL)
      const box = await frame.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.viewport.width + 0.5)
      expect(box!.y + box!.height).toBeLessThanOrEqual(size.viewport.height + 0.5)
      expect(box!.height).toBeGreaterThanOrEqual(FRAME_MIN_HEIGHT - 0.5)

      const scroll = await page.evaluate(() => ({ height: document.scrollingElement!.scrollHeight, inner: window.innerHeight }))
      expect(scroll.height).toBeLessThanOrEqual(scroll.inner + 1)

      expect(await topmostAtFrame(frame)).toEqual(['frame', 'frame', 'frame', 'frame', 'frame'])
      // The lesson bar is visible below the frame, not over it.
      const bar = page.locator('[data-lesson-action-bar]')
      await expect(bar).toBeVisible()
      const barBox = await bar.boundingBox()
      expect(barBox!.y).toBeGreaterThanOrEqual(box!.y + box!.height - 0.5)
      expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(size.viewport.height + 0.5)
    })

    test('Focus mode fills the window with the same frame; Esc leaves it, from the page and from inside the package', async ({ page, baseURL }) => {
      const frame = await openLesson(page, baseURL)
      const src = await frame.getAttribute('src')
      // A marker on the element: still there afterwards means the frame was never re-mounted or reloaded.
      await frame.evaluate((element) => element.setAttribute('data-e2e-marker', 'kept'))
      const toggle = page.getByRole('button', { name: /focus mode/i })
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')

      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      const full = await frame.boundingBox()
      // Everything but the slim header row: the whole width (bar the scrollbar gutter) and the rest of the height.
      expect(full!.y).toBeLessThanOrEqual(64)
      expect(full!.y + full!.height).toBeGreaterThanOrEqual(size.viewport.height - 1)
      expect(full!.width).toBeGreaterThanOrEqual(size.viewport.width - 20)
      expect(await topmostAtFrame(frame)).toEqual(['frame', 'frame', 'frame', 'frame', 'frame'])

      await page.keyboard.press('Escape')
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await expect(toggle).toBeFocused()
      expect(await frame.getAttribute('data-e2e-marker')).toBe('kept')
      expect(await frame.getAttribute('src')).toBe(src)

      // Esc with the keyboard focus inside the package (the bridge forwards it).
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      await frame.focus()
      await page.keyboard.press('Escape')
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      expect(await frame.getAttribute('data-e2e-marker')).toBe('kept')
    })
  })
}

test.describe('completion', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('finishing the module unlocks "Complete & next"', async ({ page, baseURL }) => {
    const frame = await openLesson(page, baseURL)
    const nav = page.getByRole('navigation', { name: 'Lesson navigation' })
    const moveOn = nav.getByRole('link', { name: /Next lesson|Back to My Learning/ })
    if (await moveOn.isVisible()) return // Already complete: the bar offers moving on.

    test.skip(process.env.E2E_SCORM_COMPLETE !== '1', 'Completing writes real progress: set E2E_SCORM_COMPLETE=1 to run this step.')
    await expect(nav.getByRole('button', { name: /Complete & next|Complete/ })).toBeDisabled()
    await expect(page.getByText('Finish the module to continue.').first()).toBeVisible()

    // Report completion through the package's own SCORM runtime, exactly as a package does.
    const content = await (await frame.elementHandle())!.contentFrame()
    expect(content).not.toBeNull()
    await content!.evaluate(() => {
      type Api12 = { LMSSetValue: (key: string, value: string) => string; LMSCommit: (arg: string) => string }
      type Api2004 = { SetValue: (key: string, value: string) => string; Commit: (arg: string) => string }
      const runtime = window as unknown as { API?: Api12; API_1484_11?: Api2004 }
      if (runtime.API) {
        runtime.API.LMSSetValue('cmi.core.lesson_status', 'completed')
        runtime.API.LMSCommit('')
      } else if (runtime.API_1484_11) {
        runtime.API_1484_11.SetValue('cmi.completion_status', 'completed')
        runtime.API_1484_11.Commit('')
      }
    })
    await expect(moveOn).toBeVisible({ timeout: 15_000 })
  })
})
