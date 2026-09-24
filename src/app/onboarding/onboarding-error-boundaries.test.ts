import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const onboardingErrorPath = 'src/app/onboarding/error.tsx'
const organizationErrorPath = 'src/app/(app)/hiring/organization/error.tsx'

function source(path: string) {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

describe('onboarding route error recovery', () => {
  it('shows a clear retry path when the main onboarding route cannot load', () => {
    expect(existsSync(onboardingErrorPath)).toBe(true)
    const errorBoundary = source(onboardingErrorPath)
    expect(errorBoundary).toContain('role="alert"')
    expect(errorBoundary).toContain('Try again')
    expect(errorBoundary).toMatch(/could not load.*onboarding/i)
    expect(errorBoundary).toContain('reset()')
  })

  it('shows a clear retry path when organization verification cannot load', () => {
    expect(existsSync(organizationErrorPath)).toBe(true)
    const errorBoundary = source(organizationErrorPath)
    expect(errorBoundary).toContain('role="alert"')
    expect(errorBoundary).toContain('Try again')
    expect(errorBoundary).toMatch(/could not load.*organization verification/i)
    expect(errorBoundary).toContain('reset()')
  })
})
