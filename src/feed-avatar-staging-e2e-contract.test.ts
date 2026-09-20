import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('scripts/aws/feed-avatar-staging-e2e.mjs', 'utf8')

describe('feed avatar staging E2E harness contract', () => {
  it('preserves the primary failure and uses cleanup-safe navigation', () => {
    expect(source).toContain('let primaryError')
    expect(source).toContain("} catch (error) {\n  primaryError = error")
    expect(source).toContain("page.goto(siteUrl + '/profile', { waitUntil: 'domcontentloaded'")
    expect(source).not.toContain("waitUntil: 'networkidle'")
    expect(source).toContain('page.waitForResponse')
    expect(source).toContain("response.request().method() === 'POST'")
    expect(source).toContain("response.request().headers()['next-action']")
    expect(source).toContain("page.waitForEvent('filechooser')")
    expect(source).toContain('fileChooser.setFiles')
    expect(source).toContain('postDataBuffer')
    expect(source).toContain("includes('avatar-' + runId + '.png')")
    expect(source).toContain("profile upload action status")
    expect(source).toContain('await response.text()')
    expect(source).toContain('profile upload action response=')
    expect(source).toContain("getByRole('alert')")
    expect(source).toContain("page.reload({ waitUntil: 'domcontentloaded' })")
    expect(source).toContain('if (primaryError) throw primaryError')
    expect(source).toContain("if (cleanupErrors.length) throw new Error('Feed avatar E2E cleanup failed:")
  })
})
