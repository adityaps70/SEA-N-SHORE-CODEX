import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { DatabaseQueryClient } from '@/lib/db/client'
import { PaymentProviderError, PaymentVerificationError } from '@/features/payments/types'
import { CashfreeSubscriptionsError, type CashfreeSubscriptionsClient } from './cashfree-subscriptions'
import { CURRENT_ACCESS_STATUSES, type CheckoutRecord } from './subscription-types'
import type { SubscriptionRepository } from './subscription-repository'
import {
  AlreadySubscribedError,
  BillingGatewayError,
  BillingNotConfiguredError,
  ContactDetailsRequiredError,
  createSubscriptionService,
  NothingToCancelError,
} from './subscription-service'
import { createMemoryBillingStore, testPrice } from './testing/memory-billing-store'

const config = { clientId: 'TEST10123456789', clientSecret: 'cfsk_ma_test_secret', environment: 'sandbox' as const, international: false }
const profileId = '33333333-3333-4333-8333-333333333333'
const subject = { kind: 'profile' as const, profileId }
const monthly = testPrice()
const yearly = testPrice({ id: '44444444-4444-4444-8444-444444444444', interval: 'year', amountMinor: 100000 })
const NOW = new Date('2026-10-01T06:00:00.000Z')

function fakeClient(overrides: Partial<CashfreeSubscriptionsClient> = {}) {
  return {
    environment: 'sandbox',
    createPlan: vi.fn(async (input: { planId: string }) => ({ planId: input.planId })),
    createSubscription: vi.fn(async (input: { subscriptionId: string }) => ({
      subscriptionId: input.subscriptionId, cfSubscriptionId: 'cf1', sessionId: 'sub_session_1', status: 'INITIALIZED',
      nextScheduleDate: null, firstChargeTime: null, paymentMethod: null, authorizationStatus: null,
    })),
    getSubscription: vi.fn(async (id: string) => ({
      subscriptionId: id, cfSubscriptionId: 'cf1', sessionId: null, status: 'ACTIVE',
      nextScheduleDate: '2026-10-03T06:00:00.000Z', firstChargeTime: null, paymentMethod: 'upi', authorizationStatus: 'ACTIVE',
    })),
    cancelSubscription: vi.fn(async () => null),
    raiseCharge: vi.fn(async () => ({ cfPaymentId: 'cfp_raised', status: 'PENDING' })),
    listSubscriptionPayments: vi.fn(async () => null),
    ...overrides,
  } as unknown as CashfreeSubscriptionsClient & Record<string, ReturnType<typeof vi.fn>>
}

function setup(options: { configured?: boolean; phone?: string | null; email?: string | null; client?: ReturnType<typeof fakeClient>; chargeMode?: 'auto' | 'merchant' } = {}) {
  const memory = createMemoryBillingStore(() => NOW)
  const deliveries = new Set<string>()
  const prices = [monthly, yearly].map((price) => ({ ...price }))
  const client = options.client ?? fakeClient()
  const tx = {
    async query(text: string, values?: readonly unknown[]) {
      if (text.includes('payment_webhook_events')) {
        const key = `${values?.[0]}:${values?.[1]}`
        if (deliveries.has(key)) return { rows: [] }
        deliveries.add(key)
        return { rows: [{ provider_event_id: values?.[1] }] }
      }
      throw new Error(`unexpected query: ${text.slice(0, 60)}`)
    },
  }
  const checkoutsOf = () => [...memory.checkouts.values()]
  const repository = {
    getActivePrice: vi.fn(async (plan: string, interval: string) => prices.find((price) => price.planCode === plan && price.interval === interval && price.active) ?? null),
    markPlanCreated: vi.fn(async (priceId: string, planId: string, environment: 'sandbox' | 'production') => {
      const price = prices.find((entry) => entry.id === priceId)!
      price.providerPlanId = planId
      price.providerEnvironment = environment
    }),
    getSubjectBilling: vi.fn(async (target: typeof subject, now: Date) => {
      const rows = [...memory.access.values()].filter((row) => row.subject.kind === 'profile' && target.kind === 'profile' && row.subject.profileId === target.profileId)
      const current = rows.find((row) => CURRENT_ACCESS_STATUSES.includes(row.status) && (!row.periodEndsAt || Date.parse(row.periodEndsAt) > now.getTime())) ?? null
      const access = current ?? rows[0] ?? null
      const checkout = access?.providerSubscriptionId ? checkoutsOf().find((row) => row.providerSubscriptionId === access.providerSubscriptionId) ?? null : null
      return { access, accessIsCurrent: Boolean(current), checkout, pendingCheckout: null, payments: [] }
    }),
    findReusableCheckout: vi.fn(async (_subject: unknown, priceId: string, environment: string, since: Date) => checkoutsOf().find((row) => row.planPriceId === priceId && row.environment === environment && row.status === 'created' && row.sessionId && Date.parse(row.createdAt) > since.getTime()) ?? null),
    getCheckout: vi.fn(async (id: string) => memory.checkouts.get(id) ?? null),
    getCheckoutByProviderSubscriptionId: vi.fn(async (id: string) => checkoutsOf().find((row) => row.providerSubscriptionId === id) ?? null),
    listCheckoutsToReconcile: vi.fn(async () => checkoutsOf().filter((row) => ['created', 'pending_approval', 'active', 'on_hold', 'replaced'].includes(row.status))),
    listChargesDue: vi.fn(async () => checkoutsOf().filter((row) => row.status === 'active' && row.nextChargeAt).map((checkout) => ({ checkout, paidCycles: 1 }))),
  }
  let ids = 0
  const log = vi.fn()
  const syncVisibility = vi.fn(async () => ({ hidden: 0, restored: 0 }))
  const trialSweep = vi.fn(async () => ({ closed: 0, reminders: 0, failures: 0 }))
  const service = createSubscriptionService({
    syncVisibility,
    trialSweep,
    loadConfig: async () => (options.configured === false ? null : config),
    createClient: () => client,
    repository: repository as unknown as SubscriptionRepository,
    transaction: async (fn) => fn(tx as unknown as DatabaseQueryClient),
    storeFor: () => memory.store,
    loadCustomer: async (user, typed) => ({
      customer: { id: user.id, email: options.email === undefined ? 'meera@example.com' : options.email, phone: typed ? '+919876543210' : options.phone === undefined ? '+919876543210' : options.phone, name: 'Meera Rao' },
      invalidPhone: typed === 'bad',
    }),
    siteUrl: () => 'https://seanshore.example',
    now: () => NOW,
    chargeMode: () => options.chargeMode ?? 'auto',
    paymentMethods: () => ['upi', 'card', 'enach'],
    newId: () => `0f7e5b1c-1111-4111-8111-${String(++ids).padStart(12, '0')}`,
    log,
  })
  return { service, memory, client, repository, prices, log, syncVisibility, trialSweep }
}

function signed(body: unknown, secret = config.clientSecret) {
  const rawBody = JSON.stringify(body)
  const timestamp = '1785401067911'
  const signature = createHmac('sha256', secret).update(timestamp + rawBody).digest('base64')
  const headers = new Headers({ 'x-webhook-timestamp': timestamp, 'x-webhook-signature': signature })
  return { rawBody, headers }
}

function statusWebhook(subscriptionId: string, status: string, eventTime = '2026-10-01T11:40:00+05:30') {
  return {
    data: {
      subscription_details: { subscription_id: subscriptionId, cf_subscription_id: 'cf1', subscription_status: status, next_schedule_date: '2026-10-03T11:30:00+05:30' },
      authorization_details: { authorization_status: status === 'ACTIVE' ? 'ACTIVE' : 'PENDING', payment_method: 'upi' },
    },
    event_time: eventTime,
    type: 'SUBSCRIPTION_STATUS_CHANGED',
  }
}

async function startMonthly(service: ReturnType<typeof setup>['service']) {
  return service.startCheckout({ subject, actor: { id: profileId, email: 'meera@example.com' }, interval: 'month' })
}

describe('starting auto-pay', () => {
  it('creates the Cashfree plan once, saves the mandate before calling Cashfree and returns the session', async () => {
    const { service, client, memory, repository } = setup()
    const started = await startMonthly(service)
    expect(started).toMatchObject({ subscriptionSessionId: 'sub_session_1', mode: 'sandbox', amountMinor: 10000, interval: 'month', startsAt: null })
    expect(client.createPlan).toHaveBeenCalledTimes(1)
    expect(repository.markPlanCreated).toHaveBeenCalledWith(monthly.id, `snsp_${monthly.id.replace(/-/g, '')}`, 'sandbox')
    const subscriptionInput = (client.createSubscription as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(subscriptionInput).toMatchObject({
      subscriptionId: `snss_${started.checkoutId.replace(/-/g, '')}`,
      planId: `snsp_${monthly.id.replace(/-/g, '')}`,
      customer: { name: 'Meera Rao', email: 'meera@example.com', phoneE164: '+919876543210' },
      returnUrl: `https://seanshore.example/api/billing/cashfree/return?checkout=${started.checkoutId}`,
      firstChargeAt: null,
    })
    expect(memory.checkouts.get(started.checkoutId)).toMatchObject({ status: 'created', sessionId: 'sub_session_1', cfSubscriptionId: 'cf1' })
    expect(memory.audits.some((entry) => entry.action === 'checkout_created')).toBe(true)

    // A double click reopens the same Cashfree session; the plan is not created again.
    const again = await startMonthly(service)
    expect(again.checkoutId).toBe(started.checkoutId)
    expect(client.createSubscription).toHaveBeenCalledTimes(1)
    expect(client.createPlan).toHaveBeenCalledTimes(1)
  })

  it('stays off with a clear error when Cashfree is not set up', async () => {
    const { service, client } = setup({ configured: false })
    await expect(startMonthly(service)).rejects.toBeInstanceOf(BillingNotConfiguredError)
    expect(client.createSubscription).not.toHaveBeenCalled()
  })

  it('asks for a mobile number and email when they are missing, and rejects bad ones', async () => {
    const noPhone = setup({ phone: null, email: null })
    await expect(startMonthly(noPhone.service)).rejects.toMatchObject({ missing: { phone: true, email: true } })
    const badEmail = setup()
    await expect(badEmail.service.startCheckout({ subject, actor: { id: profileId, email: null }, interval: 'month', typedEmail: 'not-an-email' }))
      .rejects.toMatchObject({ invalid: { phone: false, email: true } })
    const badPhone = setup()
    await expect(badPhone.service.startCheckout({ subject, actor: { id: profileId, email: 'a@b.co' }, interval: 'month', typedPhone: 'bad' }))
      .rejects.toBeInstanceOf(ContactDetailsRequiredError)
    expect(noPhone.client.createSubscription).not.toHaveBeenCalled()
  })

  it('refuses a second mandate for a plan that is already renewing', async () => {
    const { service, memory } = setup()
    const checkout = memory.seedCheckout({ price: monthly, subject, status: 'active', paidThroughAt: '2026-10-20T00:00:00.000Z' })
    memory.seedAccess({ subject, planCode: 'creator_pro', status: 'active', billingProvider: 'cashfree', providerSubscriptionId: checkout.providerSubscriptionId, periodStartedAt: null, periodEndsAt: '2026-10-23T00:00:00.000Z', cancelAtPeriodEnd: false })
    await expect(startMonthly(service)).rejects.toBeInstanceOf(AlreadySubscribedError)
  })

  it('schedules a switch to yearly for the end of the paid month', async () => {
    const { service, memory, client } = setup()
    const checkout = memory.seedCheckout({ price: monthly, subject, status: 'active', paidThroughAt: '2026-10-20T00:00:00.000Z' })
    memory.seedAccess({ subject, planCode: 'creator_pro', status: 'active', billingProvider: 'cashfree', providerSubscriptionId: checkout.providerSubscriptionId, periodStartedAt: null, periodEndsAt: '2026-10-23T00:00:00.000Z', cancelAtPeriodEnd: false })
    const started = await service.startCheckout({ subject, actor: { id: profileId, email: 'meera@example.com' }, interval: 'year' })
    expect(started.startsAt).toBe('2026-10-20T00:00:00.000Z')
    expect((client.createSubscription as ReturnType<typeof vi.fn>).mock.calls[0]![0].firstChargeAt).toEqual(new Date('2026-10-20T00:00:00.000Z'))
    expect(memory.checkouts.get(started.checkoutId)?.replacesCheckoutId).toBe(checkout.id)
  })

  it('schedules the first charge for the day a free trial ends, and never before', async () => {
    const { service, memory, client } = setup()
    memory.seedAccess({ subject, planCode: 'creator_pro', status: 'trialing', billingProvider: 'trial', providerSubscriptionId: 'trial_t1', periodStartedAt: NOW.toISOString(), periodEndsAt: '2027-01-01T06:00:00.000Z', cancelAtPeriodEnd: false })
    const started = await service.startCheckout({ subject, actor: { id: profileId, email: 'meera@example.com' }, interval: 'year' })
    expect(started.startsAt).toBe('2027-01-01T06:00:00.000Z')
    expect((client.createSubscription as ReturnType<typeof vi.fn>).mock.calls[0]![0].firstChargeAt).toEqual(new Date('2027-01-01T06:00:00.000Z'))
    expect(memory.checkouts.get(started.checkoutId)?.replacesCheckoutId).toBeNull()

    // With less than the pre-debit notice left, the charge waits that notice out instead of happening now.
    const late = setup()
    late.memory.seedAccess({ subject, planCode: 'creator_pro', status: 'trialing', billingProvider: 'trial', providerSubscriptionId: 'trial_t2', periodStartedAt: NOW.toISOString(), periodEndsAt: new Date(NOW.getTime() + 2 * 60 * 60_000).toISOString(), cancelAtPeriodEnd: false })
    const soon = await late.service.startCheckout({ subject, actor: { id: profileId, email: 'meera@example.com' }, interval: 'month' })
    expect(Date.parse(soon.startsAt!)).toBe(NOW.getTime() + 26 * 60 * 60_000)
  })

  it('sells the half-yearly Organization Pro price as a 6 × MONTH Cashfree plan', async () => {
    const { service, client, prices } = setup()
    const company = { kind: 'company' as const, companyId: '55555555-5555-4555-8555-555555555555' }
    prices.push(testPrice({ id: '66666666-6666-4666-8666-666666666666', planCode: 'organization_pro', interval: 'half_year', amountMinor: 1000000 }))
    const started = await service.startCheckout({ subject: company, actor: { id: profileId, email: 'meera@example.com' }, interval: 'half_year' })
    expect(started).toMatchObject({ amountMinor: 1000000, interval: 'half_year' })
    expect(client.createPlan).toHaveBeenCalledWith(expect.objectContaining({ interval: 'half_year', amountMinor: 1000000, name: 'Organization Pro half-yearly' }))
    expect((client.createSubscription as ReturnType<typeof vi.fn>).mock.calls[0]![0].note).toBe('Organization Pro (half-yearly)')
  })

  it('marks the mandate failed and explains when Cashfree refuses it', async () => {
    const client = fakeClient({ createSubscription: vi.fn(async () => { throw new PaymentProviderError('provider_request_failed', 400, 'customer_phone is invalid') }) as never })
    const { service, memory } = setup({ client })
    await expect(startMonthly(service)).rejects.toMatchObject({ invalid: { phone: true } })
    const [checkout] = [...memory.checkouts.values()]
    expect(checkout).toMatchObject({ status: 'failed', failureReason: 'customer_phone is invalid' })

    const down = setup({ client: fakeClient({ createSubscription: vi.fn(async () => { throw new PaymentProviderError('provider_unreachable') }) as never }) })
    await expect(startMonthly(down.service)).rejects.toBeInstanceOf(BillingGatewayError)
    await expect(startMonthly(down.service)).rejects.toMatchObject({ reason: 'gateway_error' })
  })

  it('reports "Subscriptions not enabled" when Cashfree refuses to create the plan, and logs the details', async () => {
    const client = fakeClient({ createPlan: vi.fn(async () => { throw new CashfreeSubscriptionsError(400, 'Profile is inactive', 'request_failed', 'invalid_request_error') }) as never })
    const { service, memory, log } = setup({ client })
    await expect(startMonthly(service)).rejects.toMatchObject({ reason: 'subscriptions_unavailable' })
    expect(memory.checkouts.size).toBe(0)
    expect(client.createSubscription).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('billing_plan_create_failed', expect.objectContaining({
      httpStatus: 400,
      cashfreeCode: 'request_failed',
      cashfreeType: 'invalid_request_error',
      cashfreeMessage: 'Profile is inactive',
      subscriptionsEnabled: false,
    }))
    expect(JSON.stringify(log.mock.calls)).not.toContain(config.clientSecret)
  })

  it('reports "Subscriptions not enabled" when the mandate create is refused for the same reason', async () => {
    const client = fakeClient({ createSubscription: vi.fn(async () => { throw new CashfreeSubscriptionsError(403, 'Subscription is not enabled for this merchant', null, null) }) as never })
    const { service } = setup({ client })
    await expect(startMonthly(service)).rejects.toMatchObject({ reason: 'subscriptions_unavailable' })
  })
})

describe('confirming with Cashfree', () => {
  it('applies the GET /subscriptions answer and rate-limits browser checks', async () => {
    const { service, client } = setup()
    const started = await startMonthly(service)
    const refreshed = await service.refreshCheckout(started.checkoutId)
    expect(refreshed).toMatchObject({ status: 'active', paymentMethod: 'upi' })
    await service.refreshCheckout(started.checkoutId)
    expect(client.getSubscription).toHaveBeenCalledTimes(1)
    await service.refreshCheckout(started.checkoutId, { force: true })
    expect(client.getSubscription).toHaveBeenCalledTimes(2)
  })

  it('cancels a replaced mandate at Cashfree after the new one is approved', async () => {
    const { service, memory, client } = setup()
    const old = memory.seedCheckout({ price: monthly, subject, status: 'active', paidThroughAt: '2026-10-20T00:00:00.000Z' })
    memory.seedAccess({ subject, planCode: 'creator_pro', status: 'active', billingProvider: 'cashfree', providerSubscriptionId: old.providerSubscriptionId, periodStartedAt: null, periodEndsAt: '2026-10-23T00:00:00.000Z', cancelAtPeriodEnd: false })
    const started = await service.startCheckout({ subject, actor: { id: profileId, email: 'meera@example.com' }, interval: 'year' })
    await service.refreshCheckout(started.checkoutId, { force: true })
    expect(client.cancelSubscription).toHaveBeenCalledWith(old.providerSubscriptionId)
    expect(memory.checkouts.get(old.id)).toMatchObject({ status: 'replaced', providerStatus: 'CANCELLED' })
    expect(memory.currentRows(subject)).toHaveLength(1)
  })
})

describe('subscription webhooks', () => {
  it('verifies the signature over the raw body before anything else', async () => {
    const { service, memory } = setup()
    const started = await startMonthly(service)
    const body = statusWebhook(`snss_${started.checkoutId.replace(/-/g, '')}`, 'ACTIVE')
    const forged = signed(body, 'wrong_secret')
    await expect(service.handleWebhook(forged)).rejects.toBeInstanceOf(PaymentVerificationError)
    expect(memory.checkouts.get(started.checkoutId)?.status).toBe('created')
  })

  it('activates the plan once per delivery and ignores retries of the same delivery', async () => {
    const { service, memory } = setup()
    const started = await startMonthly(service)
    const delivery = signed(statusWebhook(`snss_${started.checkoutId.replace(/-/g, '')}`, 'ACTIVE'))
    delivery.headers.set('x-idempotency-key', 'idem-1')
    await expect(service.handleWebhook(delivery)).resolves.toMatchObject({ status: 'handled', changed: true, revalidatePaths: ['/settings/billing'] })
    await expect(service.handleWebhook(delivery)).resolves.toMatchObject({ status: 'duplicate' })
    expect(memory.currentRows(subject)).toHaveLength(1)
    expect(memory.checkouts.get(started.checkoutId)).toMatchObject({ status: 'active', paymentMethod: 'upi' })
  })

  it('re-syncs the owner’s plan-gated items after a status change, and a sync failure never blocks the webhook', async () => {
    const { service, syncVisibility, log } = setup()
    const started = await startMonthly(service)
    const subscriptionId = `snss_${started.checkoutId.replace(/-/g, '')}`
    await service.handleWebhook(signed(statusWebhook(subscriptionId, 'ACTIVE')))
    expect(syncVisibility).toHaveBeenCalledWith(subject)

    syncVisibility.mockClear()
    syncVisibility.mockRejectedValueOnce(new Error('column "hidden_for_plan_at" does not exist'))
    await expect(service.handleWebhook(signed(statusWebhook(subscriptionId, 'CANCELLED', '2026-10-01T12:40:00+05:30')))).resolves.toMatchObject({ status: 'handled', changed: true })
    expect(syncVisibility).toHaveBeenCalledWith(subject)
    expect(log).toHaveBeenCalledWith('billing_plan_visibility_sync_failed', expect.objectContaining({ subject: 'profile' }))
  })

  it('records renewal payments and past-due failures from payment webhooks', async () => {
    const { service, memory } = setup()
    const started = await startMonthly(service)
    const subscriptionId = `snss_${started.checkoutId.replace(/-/g, '')}`
    await service.handleWebhook(signed({
      data: { subscription_id: subscriptionId, payment_id: 'p1', cf_payment_id: '101', payment_type: 'CHARGE', payment_amount: 100, payment_currency: 'INR', payment_status: 'SUCCESS', payment_initiated_date: '2026-10-03T11:30:00+05:30' },
      event_time: '2026-10-03T11:31:00+05:30',
      type: 'SUBSCRIPTION_PAYMENT_SUCCESS',
    }))
    expect([...memory.payments.values()]).toEqual([expect.objectContaining({ cfPaymentId: '101', status: 'success', amountMinor: 10000 })])
    expect(memory.currentRows(subject)[0]).toMatchObject({ status: 'active' })

    await service.handleWebhook(signed({
      data: { subscription_id: subscriptionId, payment_id: 'p2', cf_payment_id: '102', payment_type: 'CHARGE', payment_amount: 100, payment_status: 'FAILED', payment_initiated_date: '2026-11-03T11:30:00+05:30', failure_details: { failure_reason: 'Insufficient balance' } },
      event_time: '2026-11-03T11:31:00+05:30',
      type: 'SUBSCRIPTION_PAYMENT_FAILED',
    }))
    expect(memory.currentRows(subject)[0]).toMatchObject({ status: 'past_due' })
  })

  it('acknowledges events for unknown subscriptions and events we do not need', async () => {
    const { service } = setup()
    await expect(service.handleWebhook(signed(statusWebhook('snss_ffffffffffffffffffffffffffffffff', 'ACTIVE')))).resolves.toMatchObject({ status: 'ignored', reason: 'unknown_subscription' })
    await expect(service.handleWebhook(signed({ data: {}, type: 'SUBSCRIPTION_CARD_EXPIRY_REMINDER' }))).resolves.toMatchObject({ status: 'ignored', reason: 'not_needed' })
  })

  it('answers "not set up" when Cashfree keys are missing', async () => {
    const { service } = setup({ configured: false })
    await expect(service.handleWebhook(signed(statusWebhook('snss_x', 'ACTIVE')))).resolves.toBeNull()
  })
})

describe('cancel auto-renew', () => {
  it('cancels at Cashfree first, then keeps access to the paid-through date', async () => {
    const { service, memory, client, syncVisibility } = setup()
    const checkout = memory.seedCheckout({ price: monthly, subject, status: 'active', paidThroughAt: '2026-10-20T00:00:00.000Z' })
    memory.seedAccess({ subject, planCode: 'creator_pro', status: 'active', billingProvider: 'cashfree', providerSubscriptionId: checkout.providerSubscriptionId, periodStartedAt: null, periodEndsAt: '2026-10-23T00:00:00.000Z', cancelAtPeriodEnd: false })
    const result = await service.cancelAutoRenew({ subject, actorProfileId: profileId })
    expect(client.cancelSubscription).toHaveBeenCalledWith(checkout.providerSubscriptionId)
    expect(result.access).toMatchObject({ cancelAtPeriodEnd: true, periodEndsAt: '2026-10-20T00:00:00.000Z', status: 'active' })
    expect(syncVisibility).toHaveBeenCalledWith(subject)
    await expect(service.cancelAutoRenew({ subject, actorProfileId: profileId })).rejects.toBeInstanceOf(NothingToCancelError)
  })

  it('changes nothing when Cashfree does not confirm the cancellation', async () => {
    const client = fakeClient({ cancelSubscription: vi.fn(async () => { throw new PaymentProviderError('provider_unreachable') }) as never })
    const { service, memory } = setup({ client })
    const checkout = memory.seedCheckout({ price: monthly, subject, status: 'active', paidThroughAt: '2026-10-20T00:00:00.000Z' })
    const access = memory.seedAccess({ subject, planCode: 'creator_pro', status: 'active', billingProvider: 'cashfree', providerSubscriptionId: checkout.providerSubscriptionId, periodStartedAt: null, periodEndsAt: '2026-10-23T00:00:00.000Z', cancelAtPeriodEnd: false })
    await expect(service.cancelAutoRenew({ subject, actorProfileId: profileId })).rejects.toBeInstanceOf(BillingGatewayError)
    expect(memory.access.get(access.id)?.cancelAtPeriodEnd).toBe(false)
  })
})

describe('billing job', () => {
  it('expires lapsed plans even when Cashfree is not set up', async () => {
    const { service, memory, syncVisibility } = setup({ configured: false })
    memory.seedAccess({ subject, planCode: 'creator_pro', status: 'active', billingProvider: null, providerSubscriptionId: null, periodStartedAt: null, periodEndsAt: '2026-09-30T00:00:00.000Z', cancelAtPeriodEnd: false })
    await expect(service.runSweep()).resolves.toMatchObject({ expired: 1, configured: false })
    // Every owner: hides items of plans that ended by date, restores renewed ones.
    expect(syncVisibility).toHaveBeenCalledWith(null)
  })

  it('in merchant charge mode raises each renewal once, however often it runs', async () => {
    const { service, memory, client } = setup({ chargeMode: 'merchant' })
    const checkout: CheckoutRecord = memory.seedCheckout({ price: monthly, subject, status: 'active', paidThroughAt: '2026-10-02T06:00:00.000Z', nextChargeAt: '2026-10-02T06:00:00.000Z' })
    memory.seedAccess({ subject, planCode: 'creator_pro', status: 'active', billingProvider: 'cashfree', providerSubscriptionId: checkout.providerSubscriptionId, periodStartedAt: null, periodEndsAt: '2026-10-05T06:00:00.000Z', cancelAtPeriodEnd: false })
    const first = await service.runSweep()
    expect(first.chargesRaised).toBe(1)
    await service.runSweep()
    expect(client.raiseCharge).toHaveBeenCalledTimes(1)
    const raised = (client.raiseCharge as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(raised).toMatchObject({ subscriptionId: checkout.providerSubscriptionId, paymentId: `sc${checkout.id.replace(/-/g, '')}2`, amountMinor: 10000 })
    // UPI AutoPay needs a pre-debit notice: never scheduled sooner than ~a day ahead.
    expect(raised.scheduleAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 26 * 3600_000)
    expect([...memory.payments.values()]).toEqual([expect.objectContaining({ providerPaymentId: raised.paymentId, cfPaymentId: 'cfp_raised', status: 'pending' })])
  })

  it('in auto charge mode never raises charges', async () => {
    const { service, memory, client } = setup()
    memory.seedCheckout({ price: monthly, subject, status: 'active', nextChargeAt: '2026-10-02T06:00:00.000Z' })
    await service.runSweep()
    expect(client.raiseCharge).not.toHaveBeenCalled()
  })

  it('keeps going when one mandate cannot be reconciled', async () => {
    const client = fakeClient({ getSubscription: vi.fn(async () => { throw new PaymentProviderError('provider_unreachable') }) as never })
    const { service, memory, log } = setup({ client })
    memory.seedCheckout({ price: monthly, subject })
    memory.seedCheckout({ price: yearly, subject })
    const summary = await service.runSweep()
    expect(summary.failures).toBe(2)
    expect(log).toHaveBeenCalledWith('billing_reconcile_failed', expect.any(Object))
  })

  it('runs the free-trial sweep every time and counts its failures without stopping', async () => {
    const { service, trialSweep } = setup()
    trialSweep.mockResolvedValueOnce({ closed: 2, reminders: 1, failures: 0 })
    await expect(service.runSweep()).resolves.toMatchObject({ trialsClosed: 2, trialReminders: 1, failures: 0 })
    trialSweep.mockRejectedValueOnce(new Error('db down'))
    await expect(service.runSweep()).resolves.toMatchObject({ trialsClosed: 0, trialReminders: 0, failures: 1 })
  })
})
