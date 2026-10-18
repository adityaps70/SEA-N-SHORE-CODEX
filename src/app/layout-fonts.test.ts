import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const layout = readFileSync(join(root, 'src/app/layout.tsx'), 'utf8')
const landing = readFileSync(join(root, 'src/components/marketing/landing/landing-page.tsx'), 'utf8')
const landingCss = readFileSync(join(root, 'src/components/marketing/landing/landing.css'), 'utf8')
const globalsCss = readFileSync(join(root, 'src/app/globals.css'), 'utf8')

function expectFiles(source: string, dir: string, files: string[]) {
  for (const file of files) {
    expect(source).toContain(`./fonts/${file}`)
    expect(existsSync(join(root, dir, 'fonts', file)), file).toBe(true)
  }
}

// A build fetching fonts from Google failed CI once (Round H). Every font is a file in the repo instead, so neither the
// build nor a visitor's browser contacts Google, and the CSP needs no Google Fonts hosts.
describe('self-hosted fonts', () => {
  it('loads Inter and Plus Jakarta Sans, latin and latin-ext, from files in the repo', () => {
    expect(layout).toContain("from 'next/font/local'")
    expect(layout).not.toContain('next/font/google')
    expectFiles(layout, 'src/app', [
      'inter-latin-wght-normal.woff2',
      'inter-latin-ext-wght-normal.woff2',
      'plus-jakarta-sans-latin-600-normal.woff2',
      'plus-jakarta-sans-latin-700-normal.woff2',
      'plus-jakarta-sans-latin-ext-600-normal.woff2',
      'plus-jakarta-sans-latin-ext-700-normal.woff2',
    ])
    // Latin-ext is fetched only for pages that show those characters.
    expect(layout.match(/preload: false/g)).toHaveLength(2)
    expect(layout.match(/prop: 'unicode-range'/g)).toHaveLength(4)
  })

  it('joins each latin and latin-ext pair into the variables Tailwind maps to font-sans and font-heading', () => {
    for (const variable of ['--font-body-latin', '--font-body-latin-ext', '--font-heading-latin', '--font-heading-latin-ext']) {
      expect(layout).toContain(`variable: '${variable}'`)
    }
    expect(globalsCss).toContain('--font-body: var(--font-body-latin), var(--font-body-latin-ext);')
    expect(globalsCss).toContain('--font-heading-face: var(--font-heading-latin), var(--font-heading-latin-ext);')
    expect(globalsCss).toContain('--font-sans: var(--font-body)')
    expect(globalsCss).toContain('--font-heading: var(--font-heading-face)')
  })

  it('loads the landing page faces from files in the repo, not from Google Fonts', () => {
    expect(landing).toContain("from 'next/font/local'")
    expect(landing).not.toMatch(/fonts\.(googleapis|gstatic)\.com/)
    expectFiles(landing, 'src/components/marketing/landing', ['bricolage-grotesque-latin-opsz-normal.woff2', 'figtree-latin-wght-normal.woff2'])
    expect(landingCss).toContain('--display:var(--font-landing-display)')
    expect(landingCss).toContain('--body:var(--font-landing-body)')
    // The product mock-ups use the app's own Inter, not a font-family name that only Google Fonts supplied.
    expect(landingCss).not.toMatch(/font-family:\s*Inter\b|'(Bricolage Grotesque|Figtree)'/)
  })

  it('ships every font with its SIL Open Font License', () => {
    for (const licence of [
      'src/app/fonts/LICENSE-Inter.txt',
      'src/app/fonts/LICENSE-PlusJakartaSans.txt',
      'src/components/marketing/landing/fonts/LICENSE-BricolageGrotesque.txt',
      'src/components/marketing/landing/fonts/LICENSE-Figtree.txt',
    ]) {
      expect(readFileSync(join(root, licence), 'utf8')).toContain('SIL Open Font License, Version 1.1')
    }
  })
})
