import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('organization hiring verification experience', () => {
  it('provides one organization application form with maritime employer review fields', () => {
    const form = source('src/features/organizations/components/organization-application-form.tsx')

    expect(form).toContain('submitOrganizationApplication')
    expect(form).toContain('resubmitOrganizationApplication')
    expect(form).toContain('Organization name')
    expect(form).toContain('Organization type')
    expect(form).toContain('Website')
    expect(form).toContain('Official company email')
    expect(form).toContain('Office location')
    expect(form).toContain('Description')
    expect(form).toContain('Fleet summary')
    expect(form).toContain('Vessel types')
    expect(form).toContain('Your role / relationship')
    expect(form).toContain('Registration / reference number')
    expect(form).toContain('Supporting notes')
  })

  it('renders organization verification states in the shared workspace hub and keeps the legacy route as a redirect', () => {
    const legacyPage = source('src/app/(app)/hiring/organization/page.tsx')
    const page = source('src/app/(app)/organizations/page.tsx')

    expect(legacyPage).toContain("redirect('/organizations')")
    expect(page).toContain('getUserOrganizationState')
    expect(page).toContain('Organization verification in progress')
    expect(page).toContain('Organization access suspended')
    expect(page).toContain('adminReviewNote')
    expect(page).toContain('OrganizationApplicationForm')
    expect(page).toContain('Verification and paid Organization Pro access remain separate')
    expect(page).toContain('Organization Pro')
  })
})
