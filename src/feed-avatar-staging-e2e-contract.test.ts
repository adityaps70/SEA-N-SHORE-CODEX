import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('scripts/aws/feed-avatar-staging-e2e.mjs', 'utf8')
const controlsSource = readFileSync('src/features/profiles/components/profile-media-controls.tsx', 'utf8')

describe('feed avatar staging E2E harness contract', () => {
  it('preserves the primary failure and uses cleanup-safe navigation', () => {
    expect(source).toContain('let primaryError')
    expect(source).toContain("} catch (error) {\n  primaryError = error")
    expect(source).toContain("page.goto(siteUrl + '/profile', { waitUntil: 'domcontentloaded'")
    expect(source).not.toContain("waitUntil: 'networkidle'")
    expect(source).toContain('const input = form.locator(\'input[name="image"]\')')
    expect(source).toContain('input.setInputFiles')
    expect(source).not.toContain("page.waitForEvent('filechooser')")
    expect(source).not.toContain('Promise.race')
    expect(source).toContain("name: 'Change profile photo'")
    expect(source).toContain('page.waitForResponse')
    expect(source).toContain("response.request().method() === 'POST'")
    expect(source).not.toContain('await page.waitForTimeout(3_000)')
    expect(source).toContain("if ((await alert.count()) > 0 && await alert.isVisible().catch(() => false))")
    expect(source).toContain("getByRole('alert')")
    expect(source).not.toContain("page.reload({ waitUntil: 'domcontentloaded' })\n  await expect(page.getByRole('button', { name: 'Change profile photo' }))")
    expect(source).toContain('if (primaryError) throw primaryError')
    expect(source).toContain("if (cleanupErrors.length) throw new Error('Feed avatar E2E cleanup failed:")
  })
})


describe('profile media live state contract', () => {
  it('reflects successful upload and removal immediately while refreshing server media', () => {
    expect(controlsSource).toContain('useState(hasImage)')
    expect(controlsSource).toContain('setImagePresent(true)')
    expect(controlsSource).toContain('setImagePresent(false)')
    expect(controlsSource).toContain("[router, state]")
    expect(controlsSource).toContain("imagePresent ? 'Change' : 'Add'")
    expect(controlsSource).toContain('{imagePresent ? (')
    expect(controlsSource).toContain('router.refresh()')
  })
})
