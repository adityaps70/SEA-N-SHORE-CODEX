import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

/**
 * CSP report-only window (Oct 2026): the reports were our own scripts and fetches. Next stamps the nonce only on
 * pages rendered per request, Google sign-in was fetched by the app router, and pdf.js used eval. The rendered
 * nonce itself is checked on a production build (see the PR); these keep the three fixes in place.
 */
describe('CSP: our own scripts and fetches', () => {
  it('renders every page per request, so Next stamps the nonce on its scripts (no prerendered page)', () => {
    const layout = read('src/app/layout.tsx')
    expect(layout).toContain("import { connection } from 'next/server'")
    expect(layout).toMatch(/export default async function RootLayout\([^)]*\)[^{]*\{\s*(\/\/[^\n]*\n\s*)*await connection\(\)/)
  })

  it('opens Google sign-in from the landing page with a plain link the app router never fetches', () => {
    const hero = read('src/components/marketing/landing/landing-hero.tsx')
    expect(hero).toMatch(/<a className="sbtn" href=\{LANDING_LINKS\.googleSignIn\}>/)
    expect(hero).not.toMatch(/<Link[^>]*LANDING_LINKS\.googleSignIn/)
  })

  it('loads PDFs without eval', () => {
    expect(read('src/features/feed/pdf-page-renderer.ts')).toMatch(/getDocument\(\{[^}]*isEvalSupported: false,/)
  })
})
