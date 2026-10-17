import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PAGE_NARROW, PAGE_WIDE } from './page-width'

const css = readFileSync('src/app/globals.css', 'utf8')
const theme = css.slice(css.indexOf('@theme inline'), css.indexOf('}', css.indexOf('@theme inline')))

describe('page width tokens', () => {
  it('defines the wide and narrow content widths in the Tailwind theme', () => {
    expect(theme).toMatch(/--container-page-wide:\s*80rem;/)
    expect(theme).toMatch(/--container-page-narrow:\s*56rem;/)
  })

  it('exports centred, full-width page boxes that use those tokens', () => {
    expect(PAGE_WIDE).toBe('mx-auto w-full max-w-page-wide')
    expect(PAGE_NARROW).toBe('mx-auto w-full max-w-page-narrow')
  })
})
