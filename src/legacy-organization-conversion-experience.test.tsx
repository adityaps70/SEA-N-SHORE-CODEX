import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('legacy organization conversion experience', () => {
  it('provides a one-time conversion page that keeps human identity separate from organization workspace', () => {
    const page = source('src/app/organization-conversion/page.tsx')
    const form = source('src/features/organizations/components/legacy-organization-conversion-form.tsx')

    expect(page).toContain('legacyOrganizationConversionRepository.getConversion')
    expect(page).toContain("redirect('/home')")
    expect(page).toContain('LegacyOrganizationConversionForm')
    expect(form).toContain('Your personal identity')
    expect(form).toContain('Your organization workspace')
    expect(form).toContain('Use an organization I already manage')
    expect(form).toContain('Create an organization from my old account')
    expect(form).toContain('/hiring/organization')
    expect(form).toContain('completeLegacyOrganizationConversion')
    expect(form).toContain('profileIntents')
  })

  it('shows a persistent app reminder while legacy conversion remains pending', () => {
    const layout = source('src/app/(app)/layout.tsx')
    const banner = source('src/features/organizations/components/legacy-conversion-banner.tsx')

    expect(layout).toContain('legacyOrganizationConversionRepository.getConversion')
    expect(layout).toContain('LegacyOrganizationConversionBanner')
    expect(banner).toContain('/organization-conversion')
    expect(banner).toContain('Finish account conversion')
  })
})
