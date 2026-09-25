import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('admin membership visibility and controls', () => {
  it('shows persona, intents, plan, subscription, capabilities, verification and entitlement history on user detail', () => {
    const page = source('src/app/(app)/admin/users/[profileId]/page.tsx')

    expect(page).toContain('membership.persona')
    expect(page).toContain('membership.intents')
    expect(page).toContain('membership.plan')
    expect(page).toContain('membership.subscription')
    expect(page).toContain('membership.effectiveCapabilities')
    expect(page).toContain('membership.verifications')
    expect(page).toContain('membership.verificationHistory')
    expect(page).toContain('membership.entitlementHistory')
    expect(page).toContain('AdminEntitlementControlPanel')
  })

  it('shows organization plan, subscription, managers and entitlement history on organization detail', () => {
    const page = source('src/app/(app)/admin/organizations/[applicationId]/page.tsx')

    expect(page).toContain('getOrganizationAccessOverview')
    expect(page).toContain('membership.plan')
    expect(page).toContain('membership.subscription')
    expect(page).toContain('membership.managers')
    expect(page).toContain('membership.entitlementHistory')
    expect(page).toContain('AdminEntitlementControlPanel')
  })

  it('keeps manual entitlement controls narrow and audited', () => {
    const repository = source('src/features/admin/membership-repository.ts')
    const policy = source('src/features/admin/membership-policy.ts')

    expect(repository).toContain("'entitlement.granted'")
    expect(repository).toContain("'entitlement.revoked'")
    expect(repository).toContain("values ($1, $2, 'admin'")
    expect(repository).toContain("source in ('admin', 'legacy_migration')")
    expect(policy).toContain('ADMIN_PERSONAL_GRANTABLE_CAPABILITIES')
    expect(policy).toContain('ADMIN_ORGANIZATION_GRANTABLE_CAPABILITIES')
    expect(policy).not.toContain("'billing.manage'")
    expect(policy).not.toContain("'organization.manage'")
  })
})
