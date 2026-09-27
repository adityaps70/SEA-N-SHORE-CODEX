import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  user: { id: '33333333-3333-4333-8333-333333333333', cognitoSub: 'sub', email: 'meera@example.com' },
  access: null as unknown,
  startCheckout: vi.fn(),
  refreshCheckout: vi.fn(),
  cancelAutoRenew: vi.fn(),
  getCheckout: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: async () => mocks.user }))
vi.mock('@/features/access/server', () => ({ getAccessContext: async () => mocks.access }))
vi.mock('./repository', () => ({ billingRepository: { getOrganizationBillingOverview: async () => ({ company: { name: 'Sea Academy' } }) } }))
vi.mock('./subscription-repository', () => ({ subscriptionRepository: { getCheckout: mocks.getCheckout } }))
vi.mock('./subscription-service', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>
  return {
    ...original,
    subscriptionService: {
      startCheckout: mocks.startCheckout,
      refreshCheckout: mocks.refreshCheckout,
      cancelAutoRenew: mocks.cancelAutoRenew,
    },
  }
})

import { cancelAutoRenewAction, checkPlanCheckoutAction, startPlanCheckoutAction } from './actions'
import { AlreadySubscribedError, BillingGatewayError, BillingNotConfiguredError, ContactDetailsRequiredError, NothingToCancelError } from './subscription-service'

const companyId = '55555555-5555-4555-8555-555555555555'
const checkoutId = '0f7e5b1c-1111-4111-8111-111111111111'

function accessWith(role: string | null, verified = true, accountActive = true) {
  return {
    personalPlan: 'free',
    personalEntitlements: [],
    verifications: [],
    accountActive,
    organizationMemberships: role ? [{ companyId, plan: 'free', role, verified, entitlements: [] }] : [],
  }
}

function checkoutRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: checkoutId, subject: { kind: 'profile', profileId: mocks.user.id }, planCode: 'creator_pro', interval: 'month', amountMinor: 10000,
    status: 'created', nextChargeAt: null, paidThroughAt: null, ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.access = accessWith(null)
})

describe('starting a plan checkout', () => {
  it('starts Creator Pro for the signed-in member only', async () => {
    mocks.startCheckout.mockResolvedValue({ checkoutId, subscriptionSessionId: 'sub_session_1', mode: 'sandbox', amountMinor: 10000, interval: 'month', startsAt: null })
    await expect(startPlanCheckoutAction({ target: { kind: 'personal' }, interval: 'month' })).resolves.toEqual({ ok: true, checkoutId, subscriptionSessionId: 'sub_session_1', mode: 'sandbox' })
    expect(mocks.startCheckout).toHaveBeenCalledWith(expect.objectContaining({ subject: { kind: 'profile', profileId: mocks.user.id }, interval: 'month' }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/settings/billing')
  })

  it('lets only an owner or administrator buy Organization Pro, and only for a verified organization', async () => {
    mocks.access = accessWith('recruiter')
    const recruiter = await startPlanCheckoutAction({ target: { kind: 'organization', companyId }, interval: 'year' })
    expect(recruiter).toEqual({ ok: false, error: 'Only the organization’s owner or an administrator can manage its plan.' })

    mocks.access = accessWith('owner', false)
    const unverified = await startPlanCheckoutAction({ target: { kind: 'organization', companyId }, interval: 'year' })
    expect(unverified.ok).toBe(false)
    expect(!unverified.ok && unverified.error).toContain('once your organization is verified')

    mocks.access = accessWith(null)
    const stranger = await startPlanCheckoutAction({ target: { kind: 'organization', companyId }, interval: 'year' })
    expect(stranger.ok).toBe(false)
    expect(mocks.startCheckout).not.toHaveBeenCalled()

    mocks.access = accessWith('administrator')
    mocks.startCheckout.mockResolvedValue({ checkoutId, subscriptionSessionId: 's', mode: 'production', amountMinor: 2000000, interval: 'year', startsAt: null })
    await expect(startPlanCheckoutAction({ target: { kind: 'organization', companyId }, interval: 'year' })).resolves.toMatchObject({ ok: true })
    expect(mocks.startCheckout).toHaveBeenCalledWith(expect.objectContaining({ subject: { kind: 'company', companyId }, label: 'Sea Academy' }))
  })

  it('refuses restricted accounts and bad input', async () => {
    mocks.access = accessWith(null, true, false)
    await expect(startPlanCheckoutAction({ target: { kind: 'personal' }, interval: 'month' })).resolves.toMatchObject({ ok: false })
    await expect(startPlanCheckoutAction({ target: { kind: 'personal' }, interval: 'week' as 'month' })).resolves.toEqual({ ok: false, error: 'Choose monthly or yearly, then try again.' })
    expect(mocks.startCheckout).not.toHaveBeenCalled()
  })

  it('turns every failure into a clear message', async () => {
    mocks.startCheckout.mockRejectedValueOnce(new BillingNotConfiguredError())
    const off = await startPlanCheckoutAction({ target: { kind: 'personal' }, interval: 'month' })
    expect(!off.ok && off.error).toContain('Nothing can be charged until it is ready')

    mocks.startCheckout.mockRejectedValueOnce(new ContactDetailsRequiredError({ phone: true, email: false }))
    await expect(startPlanCheckoutAction({ target: { kind: 'personal' }, interval: 'month' })).resolves.toMatchObject({ ok: false, needsContact: { phone: true, email: false } })

    mocks.startCheckout.mockRejectedValueOnce(new AlreadySubscribedError('same_plan_renewing'))
    await expect(startPlanCheckoutAction({ target: { kind: 'personal' }, interval: 'month' })).resolves.toEqual({ ok: false, error: 'You already have this plan on auto-renew. Nothing new was set up.' })

    mocks.startCheckout.mockRejectedValueOnce(new BillingGatewayError('Plan limit reached.'))
    const gateway = await startPlanCheckoutAction({ target: { kind: 'personal' }, interval: 'month' })
    expect(!gateway.ok && gateway.error).toBe('Our payment partner couldn’t start auto-pay just now (Plan limit reached). No money was taken. Please try again in a few minutes.')

    mocks.startCheckout.mockRejectedValueOnce(new Error('boom'))
    const unknown = await startPlanCheckoutAction({ target: { kind: 'personal' }, interval: 'month' })
    expect(!unknown.ok && unknown.error).toContain('No money was taken')
  })
})

describe('checking a checkout', () => {
  it('answers from the server state for the owner of the checkout', async () => {
    mocks.getCheckout.mockResolvedValue(checkoutRecord())
    mocks.refreshCheckout.mockResolvedValue(checkoutRecord({ status: 'active', nextChargeAt: '2026-10-03T06:00:00.000Z' }))
    const result = await checkPlanCheckoutAction(checkoutId)
    expect(result).toMatchObject({ state: 'active', title: 'Creator Pro is active' })
  })

  it('never reveals someone else’s checkout', async () => {
    mocks.getCheckout.mockResolvedValue(checkoutRecord({ subject: { kind: 'profile', profileId: '99999999-9999-4999-8999-999999999999' } }))
    await expect(checkPlanCheckoutAction(checkoutId)).resolves.toMatchObject({ state: 'unknown' })
    expect(mocks.refreshCheckout).not.toHaveBeenCalled()

    mocks.getCheckout.mockResolvedValue(checkoutRecord({ subject: { kind: 'company', companyId } }))
    mocks.access = accessWith('member')
    await expect(checkPlanCheckoutAction(checkoutId)).resolves.toMatchObject({ state: 'unknown', title: 'You can’t view this plan' })
    await expect(checkPlanCheckoutAction('not-a-uuid')).resolves.toMatchObject({ state: 'unknown' })
  })

  it('keeps waiting (without error) when Cashfree cannot be reached', async () => {
    mocks.getCheckout.mockResolvedValue(checkoutRecord())
    mocks.refreshCheckout.mockRejectedValue(new Error('provider_unreachable'))
    await expect(checkPlanCheckoutAction(checkoutId)).resolves.toMatchObject({ state: 'unknown' })
  })
})

describe('cancelling auto-renew', () => {
  it('reports the last day of access', async () => {
    mocks.cancelAutoRenew.mockResolvedValue({ changed: true, followUps: [], checkout: checkoutRecord({ status: 'cancelled', paidThroughAt: '2026-11-01T06:00:00.000Z' }), access: { status: 'active', periodEndsAt: '2026-11-01T06:00:00.000Z' } })
    const result = await cancelAutoRenewAction({ target: { kind: 'personal' } })
    expect(result.ok && result.message).toMatch(/^Auto-renew is off\. Creator Pro stays active until .+, and nothing more will be charged\.$/)
  })

  it('checks the organization role on the server and explains failures', async () => {
    mocks.access = accessWith('event_manager')
    await expect(cancelAutoRenewAction({ target: { kind: 'organization', companyId } })).resolves.toMatchObject({ ok: false })
    expect(mocks.cancelAutoRenew).not.toHaveBeenCalled()

    mocks.cancelAutoRenew.mockRejectedValueOnce(new NothingToCancelError())
    await expect(cancelAutoRenewAction({ target: { kind: 'personal' } })).resolves.toMatchObject({ ok: false, error: expect.stringContaining('already off') })
    mocks.cancelAutoRenew.mockRejectedValueOnce(new BillingGatewayError(null))
    await expect(cancelAutoRenewAction({ target: { kind: 'personal' } })).resolves.toMatchObject({ ok: false, error: expect.stringContaining('auto-renew is still on') })
  })
})
