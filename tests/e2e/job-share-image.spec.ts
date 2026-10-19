import { expect, test } from '@playwright/test'
import { buildShareContent, type ShareJob, type ShareSettings } from '../../src/features/jobs/share/share-content'
import { defaultShareOptions, type ShareLook, type ShareOptions, type ShareSize } from '../../src/features/jobs/share/share-options'
import { renderShareImage } from '../../src/features/jobs/share/share-render'

/**
 * Round I (I1): visual snapshots of the job share image, 2 sizes × 2 looks, shown the way the share panel shows
 * them at 390 px (phone) and on desktop. The PNG is the server's own renderer, so a change to the design shows
 * up here. Placeholder job only. With E2E_POSTER_EMAIL, E2E_POSTER_PASSWORD and E2E_SHARE_JOB_ID (a live job
 * that account may share) it also opens the real panel from the job page.
 */
const JOB: ShareJob = {
  id: '7d3f1c2a-1111-4222-8333-444455556666',
  title: 'Chief Officer – LR2 Product Tanker',
  companyName: 'Placeholder Ship Management',
  companyId: 'c0000000-0000-4000-8000-000000000001',
  companyLogoPath: null,
  location: 'Mumbai, India',
  salaryMin: 9000,
  salaryMax: 11000,
  salaryCurrency: 'USD',
  salaryPeriod: 'month',
  publishedAt: '2026-10-18T05:30:00.000Z',
  createdAt: '2026-10-18T05:00:00.000Z',
  updatedAt: '2026-10-18T05:30:00.000Z',
  urgent: true,
  vesselTypes: ['Product tanker'],
  experienceMinYears: 2,
  experienceMaxYears: null,
  joiningFrom: '2026-11-15',
  joiningUntil: null,
  applyUntil: '2026-11-05',
  postedByPlatformAdmin: false,
}

const SETTINGS: ShareSettings = {
  socials: { instagram: 'seaandshore.in', linkedin: '', facebook: 'seaandshore.in', x: 'inseaandshore', youtube: '' },
  partners: [],
}

const CASES: Array<[ShareSize, ShareLook]> = [['portrait', 'navy'], ['portrait', 'white'], ['linkedin', 'navy'], ['linkedin', 'white']]
const VIEWPORTS = [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }] as const

test.describe('job share image snapshots', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'One browser is enough for the image snapshots.')

  for (const [size, look] of CASES) {
    for (const viewport of VIEWPORTS) {
      test(`${size} × ${look} at ${viewport.name}`, async ({ page }) => {
        const options: ShareOptions = { ...defaultShareOptions(JOB), size, look }
        const { png, layout } = await renderShareImage({ content: buildShareContent(JOB, options, SETTINGS, 'https://seanshore.in'), options, loadMedia: async () => null })
        expect(layout.fits).toBe(true)
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        const maxWidth = size === 'linkedin' ? 560 : 420
        await page.setContent(`<!doctype html><html><body style="margin:0;padding:16px;background:#f3f7fa">
          <img alt="Share image preview" style="display:block;width:100%;max-width:${maxWidth}px;height:auto;margin:0 auto;border-radius:16px" src="data:image/png;base64,${png.toString('base64')}">
        </body></html>`)
        const image = page.getByRole('img', { name: 'Share image preview' })
        await expect(image).toBeVisible()
        // No horizontal page scroll at 390 px.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await expect(image).toHaveScreenshot(`${size}-${look}-${viewport.name}.png`, { maxDiffPixelRatio: 0.01 })
      })
    }
  }
})

test('the poster opens the share panel from the job page', async ({ page }) => {
  const email = process.env.E2E_POSTER_EMAIL
  const password = process.env.E2E_POSTER_PASSWORD
  const jobId = process.env.E2E_SHARE_JOB_ID
  test.skip(!email || !password || !jobId, 'Set E2E_POSTER_EMAIL, E2E_POSTER_PASSWORD and E2E_SHARE_JOB_ID to open the real panel.')

  await page.goto('/auth/sign-in')
  await page.getByLabel('Email').fill(email as string)
  await page.getByLabel('Password').fill(password as string)
  await page.getByRole('button', { name: /^Sign in/ }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/'))
  await page.goto(`/jobs/${jobId}`)
  await page.getByRole('button', { name: 'Share job' }).click()
  const dialog = page.getByRole('dialog', { name: 'Share job' })
  await expect(dialog.getByRole('tab', { name: 'Download image' })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByTestId('job-share-fit')).toContainText('Fits')
  await expect(dialog.getByRole('link', { name: 'Download PNG' })).toBeVisible()
  await dialog.getByRole('tab', { name: 'Post to feed' }).click()
  await expect(dialog.getByRole('tabpanel', { name: 'Post to feed' })).toBeVisible()
})
