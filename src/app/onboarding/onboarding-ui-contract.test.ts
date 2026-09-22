import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync('src/app/onboarding/page.tsx', 'utf8')
const form = readFileSync('src/features/profiles/components/onboarding-form.tsx', 'utf8')

describe('onboarding UI contract', () => {
  it('uses the Sea N Shore wordmark and removes the decorative route squiggle', () => {
    expect(page).toContain('<Wordmark compact />')
    expect(page).not.toContain('RouteLine')
  })

  it('keeps onboarding compact and visually aligned with the current app shell', () => {
    expect(page).toContain('max-w-5xl')
    expect(page).toContain('rounded-[1.75rem]')
    expect(page).toContain('Build your maritime presence')
  })

  it('makes identity roots feel like real selectable product cards', () => {
    expect(form).toContain('UserRound')
    expect(form).toContain('Building2')
    expect(form).toContain('Check')
    expect(form).toContain('Choose the identity that best represents how you want to participate on Sea N Shore.')
  })
})
