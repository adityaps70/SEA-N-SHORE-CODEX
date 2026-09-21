import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const script = readFileSync('scripts/aws/verify-staging-logo-browser.mjs', 'utf8')

describe('staging browser style regression guard', () => {
  it('fails when the compact header logo expands like an unstyled page', () => {
    expect(script).toContain('state.rect.width > 180')
    expect(script).toContain('Header logo rendered outside compact styled bounds')
  })

  it('requires a loaded Next stylesheet and rejects failed CSS requests', () => {
    expect(script).toContain("link[rel=\"stylesheet\"]")
    expect(script).toContain("/_next/static/")
    expect(script).toContain('FAILED_STYLESHEET_REQUESTS')
  })
})
