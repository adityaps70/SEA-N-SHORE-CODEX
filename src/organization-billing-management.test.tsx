import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

// Round 5: Organization Pro is bought with a Cashfree auto-pay mandate. Only an
// organization's owner or administrator can buy or manage it (billing.manage comes WITH
// Organization Pro, so it cannot be the gate for buying it).
describe('organization billing management experience', () => {
  it('shows billing-management links only for organizations the member owns or administers', () => {
    const page = source('src/app/(app)/settings/billing/page.tsx')
    expect(page).toContain('listUserOrganizations')
    expect(page).toContain('organizationProCandidates')

    // Round 6: the list (owner/administrator organizations only) lives in the chooser.
    const path = source('src/features/billing/organization-pro-path.ts')
    expect(path).toContain("membership.role !== 'owner' && membership.role !== 'administrator'")
    expect(path).toContain('/settings/billing/organizations/')
    const chooser = source('src/features/billing/components/organization-pro-chooser.tsx')
    expect(chooser).toContain('Upgrade to Organization Pro')

    const rules = source('src/features/billing/billing-access.ts')
    expect(rules).toContain("membership?.role === 'owner' || membership?.role === 'administrator'")
  })

  it('rechecks the organization role server-side on the detail route and in every action', () => {
    const page = source('src/app/(app)/settings/billing/organizations/[companyId]/page.tsx')
    expect(page).toContain('canManageOrganizationBilling(access, companyId)')
    expect(page).toContain("'billing.manage'")
    expect(page).toContain('getOrganizationBillingOverview')
    expect(page).toContain('notFound')

    const actions = source('src/features/billing/actions.ts')
    expect(actions).toContain("'use server'")
    expect(actions).toContain('canManageOrganizationBilling(access, target.companyId)')
    expect(actions).toContain('organizationIsVerified(access, target.companyId)')
  })

  it('shows real prices from the database only, never invented ones in the page source', () => {
    const page = source('src/app/(app)/settings/billing/organizations/[companyId]/page.tsx')

    expect(page).toContain('Organization Pro')
    expect(page).toContain('loadPlanBillingView')
    expect(page).toContain('/plans')
    expect(page).not.toContain('₹')
    expect(page).not.toContain('USD')
    expect(page).not.toContain('Stripe')
    expect(page).not.toContain('Razorpay')
  })
})
