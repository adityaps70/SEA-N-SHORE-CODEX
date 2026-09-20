import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../scripts/aws/feed-avatar-staging-e2e.mjs', import.meta.url), 'utf8')

describe('feed avatar staging E2E harness contract', () => {
  it('preserves the primary failure and uses cleanup-safe navigation', () => {
    expect(source).toMatch(/let primaryError/)
    expect(source).toMatch(/catch \(error\) \{\s*primaryError = error/s)
    expect(source).toMatch(/page\.goto\(siteUrl \+ '\/profile', \{ waitUntil: 'domcontentloaded'/)
    expect(source).toMatch(/if \(primaryError\) throw primaryError/)
    expect(source).toMatch(/if \(cleanupErrors\.length\) throw new Error/)
  })
})
