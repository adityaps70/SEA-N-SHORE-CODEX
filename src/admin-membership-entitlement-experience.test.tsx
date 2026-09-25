import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('admin membership and entitlement experience', () => {
  it('shows persona, intents, plan, effective capabilities, verifications and entitlement history on user detail', () => {
    const page = source('src/app/(app)/admin/users/[profileId]/page.tsx')

    expect(page).toContain('getUserAccessOverview')
    expect(page).toContain('Persona')
    expect(page).toContain('Profile intents')
    expect(page).toContain('Current plan')
    expect(page).toContain('Effective capabilities')
    expect(page).toContain('Professional verifications')
    expect(page).toContain('Verification history')
    expect(page).toContain('Entitlement history')
    expect(page).toContain('AdminEntitlementControlPanel')
  })

  it('shows organization plan, verification, authorized managers and entitlement history', () => {
    const page = source('src/app/(app)/admin/organizations/[applicationId]/page.tsx')

    expect(page).toContain('getOrganizationAccessOverview')
    expect(page).toContain('Organization Pro')
    expect(page).toContain('Authorized managers')
    expect(page).toContain('Entitlement history')
    expect(page).toContain('AdminEntitlementControlPanel')
  })

  it('keeps admin manual grants intentionally narrow', () => {
    const repository = source('src/features/admin/membership-repository.ts')

    expect(repository).toContain('ADMIN_PERSONAL_GRANTABLE_CAPABILITIES')
    expect(repository).toContain("'job.publish'")
    expect(repository).toContain("'event.publish'")
    expect(repository).toContain("'course.publish'")
    expect(repository).toContain('ADMIN_ORGANIZATION_GRANTABLE_CAPABILITIES')
    expect(repository).not.toContain("'billing.manage',\n] as const")
  })

  it('provides explicit reason-based grant and revoke UI', () => {
    const panel = source('src/features/admin/components/admin-entitlement-control-panel.tsx')

    expect(panel).toContain('grantAdminEntitlement')
    expect(panel).toContain('revokeAdminEntitlement')
    expect(panel).toContain('Reason')
    expect(panel).toContain('Grant entitlement')
    expect(panel).toContain('Revoke')
  })

  it('relies on central accountActive policy so suspension overrides plan and grants', () => {
    const policy = source('src/features/access/policy.ts')

    expect(policy).toContain('if (!access.accountActive) return []')
    expect(policy).toContain('if (!access.accountActive) return false')
  })
})
