import { describe, expect, it } from 'vitest'
import { createBillingRepository } from './repository'

const companyId = '11111111-1111-4111-8111-111111111111'

describe('organization billing repository', () => {
  it('returns provider-neutral Organization Pro subscription state without provider secrets', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createBillingRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{
          company_id: companyId,
          company_name: 'Sea Academy',
          company_slug: 'sea-academy',
          company_verified: true,
          subscription_id: 'subscription-1',
          plan_code: 'organization_pro',
          subscription_status: 'active',
          billing_provider: 'future-provider',
          current_period_started_at: '2026-09-01T00:00:00.000Z',
          current_period_ends_at: '2026-10-01T00:00:00.000Z',
          cancel_at_period_end: false,
          subscription_created_at: '2026-09-01T00:00:00.000Z',
          subscription_updated_at: '2026-09-20T00:00:00.000Z',
        }]
      },
    })

    await expect(repository.getOrganizationBillingOverview(companyId)).resolves.toEqual({
      company: {
        id: companyId,
        name: 'Sea Academy',
        slug: 'sea-academy',
        verified: true,
      },
      currentPlan: 'organization_pro',
      subscription: {
        id: 'subscription-1',
        plan: 'organization_pro',
        status: 'active',
        billingProvider: 'future-provider',
        currentPeriodStartedAt: '2026-09-01T00:00:00.000Z',
        currentPeriodEndsAt: '2026-10-01T00:00:00.000Z',
        cancelAtPeriodEnd: false,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-20T00:00:00.000Z',
      },
    })

    expect(seen[0]?.text).toContain('public.companies')
    expect(seen[0]?.text).toContain('public.account_subscriptions')
    expect(seen[0]?.text).not.toContain('provider_customer_id')
    expect(seen[0]?.text).not.toContain('provider_subscription_id')
    expect(seen[0]?.values).toEqual([companyId])
  })

  it('shows Free when the organization has no current paid subscription', async () => {
    const repository = createBillingRepository({
      query: async () => [{
        company_id: companyId,
        company_name: 'Sea Academy',
        company_slug: 'sea-academy',
        company_verified: true,
        subscription_id: 'subscription-old',
        plan_code: 'organization_pro',
        subscription_status: 'cancelled',
        billing_provider: null,
        current_period_started_at: '2026-08-01T00:00:00.000Z',
        current_period_ends_at: '2026-09-01T00:00:00.000Z',
        cancel_at_period_end: false,
        subscription_created_at: '2026-08-01T00:00:00.000Z',
        subscription_updated_at: '2026-09-01T00:00:00.000Z',
      }],
    })

    await expect(repository.getOrganizationBillingOverview(companyId)).resolves.toMatchObject({
      currentPlan: 'free',
      subscription: {
        status: 'cancelled',
      },
    })
  })

  it('returns null for an unknown organization', async () => {
    const repository = createBillingRepository({ query: async () => [] })
    await expect(repository.getOrganizationBillingOverview(companyId)).resolves.toBeNull()
  })
})
