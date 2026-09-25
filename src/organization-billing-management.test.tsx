import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('organization billing management experience', () => {
  it('shows billing-management links only for organizations with billing.manage', () => {
    const page = source('src/app/(app)/settings/billing/page.tsx')

    expect(page).toContain('listUserOrganizations')
    expect(page).toContain('canUseCapability')
    expect(page).toContain("'billing.manage'")
    expect(page).toContain('/settings/billing/organizations/')
    expect(page).toContain('Manage organization billing')
  })

  it('rechecks organization billing.manage server-side on the detail route', () => {
    const page = source('src/app/(app)/settings/billing/organizations/[companyId]/page.tsx')

    expect(page).toContain('requireCapability')
    expect(page).toContain("'billing.manage'")
    expect(page).toContain('{ companyId }')
    expect(page).toContain('getOrganizationBillingOverview')
    expect(page).toContain('notFound')
  })

  it('shows provider-neutral subscription state without fake checkout or invented prices', () => {
    const page = source('src/app/(app)/settings/billing/organizations/[companyId]/page.tsx')

    expect(page).toContain('Organization Pro')
    expect(page).toContain('Subscription status')
    expect(page).toContain('Billing provider')
    expect(page).toContain('currentPeriodEndsAt')
    expect(page).toContain('/plans')
    expect(page).toContain('checkout is not enabled')
    expect(page).not.toContain('₹')
    expect(page).not.toContain('$')
    expect(page).not.toContain('Stripe')
    expect(page).not.toContain('Razorpay')
  })
})
