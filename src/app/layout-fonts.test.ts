import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const layout = readFileSync(join(root, 'src/app/layout.tsx'), 'utf8')

// A build fetching fonts from Google failed CI once (Round H). The app's fonts are files in the repo instead.
describe('root layout fonts', () => {
  it('loads Inter and Plus Jakarta Sans from files in the repo, not from Google', () => {
    expect(layout).toContain("from 'next/font/local'")
    expect(layout).not.toContain('next/font/google')
    for (const file of [
      'inter-latin-wght-normal.woff2',
      'plus-jakarta-sans-latin-600-normal.woff2',
      'plus-jakarta-sans-latin-700-normal.woff2',
    ]) {
      expect(layout).toContain(`./fonts/${file}`)
      expect(existsSync(join(root, 'src/app/fonts', file)), file).toBe(true)
    }
  })

  it('keeps the CSS variables that globals.css maps to font-sans and font-heading', () => {
    expect(layout).toContain("variable: '--font-body'")
    expect(layout).toContain("variable: '--font-heading-face'")
    const css = readFileSync(join(root, 'src/app/globals.css'), 'utf8')
    expect(css).toContain('--font-body')
    expect(css).toContain('--font-heading-face')
  })

  it('ships the fonts with their SIL Open Font License', () => {
    for (const licence of ['LICENSE-Inter.txt', 'LICENSE-PlusJakartaSans.txt']) {
      expect(readFileSync(join(root, 'src/app/fonts', licence), 'utf8')).toContain('SIL Open Font License, Version 1.1')
    }
  })
})
