import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))

import { PaymentProviderError } from '@/features/payments/types'
import type { CashfreeBeneficiary, CashfreePayoutsClient, CashfreeTransfer } from './cashfree-payouts-client'
import { PayoutError } from './payout-repository'
import { PayoutProviderError, PayoutsNotConfiguredError, createPayoutService } from './payout-service'
import { account, ADMIN_ID, COMPANY_ID, createLedger, earning, SELLER_ID } from './test-ledger'

const E1 = 'e1111111-1111-4111-8111-111111111111'
const E2 = 'e2222222-2222-4222-8222-222222222222'
const NEW_ID = '99999999-9999-4999-8999-999999999999'
const config = { clientId: 'id', clientSecret: 'secret', publicKeyPem: null, environment: 'sandbox' as const }
const seller = { profileId: SELLER_ID }
const bankDetails = { method: 'bank' as const, holderName: 'Arjun Rao', accountNumber: '00011020001772', confirmAccountNumber: '00011020001772', ifsc: 'HDFC0000001' }

function transfer(overrides: Partial<CashfreeTransfer> = {}): CashfreeTransfer {
  return { transferId: 'x', cfTransferId: 'CF1', status: 'RECEIVED', statusCode: 'RECEIVED', statusDescription: null, utr: null, amountMinor: 62874, transferMode: 'banktransfer', ...overrides }
}

function fakeClient() {
  return {
    environment: 'sandbox',
    createBeneficiary: vi.fn(async (input: { beneficiaryId: string }): Promise<CashfreeBeneficiary> => ({ beneficiaryId: input.beneficiaryId, status: 'VERIFIED', bankAccountLast4: '1772', bankIfsc: 'HDFC0000001', vpa: null })),
    getBeneficiary: vi.fn(),
    findBeneficiaryByBankAccount: vi.fn(async () => null),
    removeBeneficiary: vi.fn(async () => ({ removed: true })),
    createTransfer: vi.fn(async (input: { transferId: string }) => transfer({ transferId: input.transferId })),
    getTransfer: vi.fn(async () => null as CashfreeTransfer | null),
  }
}

let client: ReturnType<typeof fakeClient>
let ids: string[]

function setup(initial: Parameters<typeof createLedger>[0] = {}, options: { configured?: boolean; now?: () => Date } = {}) {
  const db = createLedger(initial)
  const service = createPayoutService({
    transaction: db.transaction,
    read: db.client,
    loadConfig: async () => (options.configured === false ? null : config),
    createClient: () => client as unknown as CashfreePayoutsClient,
    newId: () => ids.shift() ?? NEW_ID,
    now: options.now,
    log: () => undefined,
  })
  return { ...db, service }
}

function ready(options: { now?: () => Date } = {}) {
  return setup({ accounts: [account()], earnings: [earning(E1, { net_minor: 44910 }), earning(E2, { net_minor: 17964 })] }, options)
}

const send = { actorProfileId: ADMIN_ID, seller, earningIds: [E1, E2], expectedTotalMinor: 62874 }

beforeEach(() => {
  client = fakeClient()
  ids = ['77777777-7777-4777-8777-777777777777']
})

describe('payout details (Cashfree beneficiaries)', () => {
  it('sends the full number to Cashfree and keeps only the last 4 digits', async () => {
    const db = setup()
    ids = [NEW_ID]
    const { account: saved, replaced } = await db.service.addPayoutAccount({ actorProfileId: SELLER_ID, seller, details: bankDetails })
    expect(client.createBeneficiary).toHaveBeenCalledWith({ beneficiaryId: 'snsb_99999999999949998999999999999999', name: 'Arjun Rao', bankAccountNumber: '00011020001772', bankIfsc: 'HDFC0000001' })
    expect(saved).toMatchObject({ method: 'bank', last4: '1772', ifsc: 'HDFC0000001', providerVerified: true })
    expect(replaced).toBe(false)
    expect(JSON.stringify(db.ledger.accounts)).not.toContain('00011020001772')
  })

  it('refuses someone who does not manage the seller, before calling Cashfree', async () => {
    const db = setup()
    await expect(db.service.addPayoutAccount({ actorProfileId: ADMIN_ID, seller: { companyId: COMPANY_ID }, details: bankDetails })).rejects.toMatchObject({ code: 'forbidden' })
    expect(client.createBeneficiary).not.toHaveBeenCalled()
  })

  it('stays off when payouts are not configured', async () => {
    const db = setup({}, { configured: false })
    await expect(db.service.addPayoutAccount({ actorProfileId: SELLER_ID, seller, details: bankDetails })).rejects.toBeInstanceOf(PayoutsNotConfiguredError)
  })

  it('replaces older details and removes the old beneficiary at Cashfree', async () => {
    const db = setup({ accounts: [account()] })
    ids = [NEW_ID]
    const result = await db.service.addPayoutAccount({ actorProfileId: SELLER_ID, seller, details: { method: 'upi', holderName: 'Arjun Rao', vpa: 'arjun@okhdfc' } })
    expect(result.replaced).toBe(true)
    expect(client.removeBeneficiary).toHaveBeenCalledWith('snsb_existing')
  })

  it('reuses an existing Cashfree beneficiary for the same bank account (409)', async () => {
    const db = setup()
    client.createBeneficiary.mockRejectedValueOnce(new PaymentProviderError('provider_request_failed', 409, 'Beneficiary already exists'))
    client.findBeneficiaryByBankAccount.mockResolvedValueOnce({ beneficiaryId: 'snsb_shared', status: 'VERIFIED', bankAccountLast4: '1772', bankIfsc: 'HDFC0000001', vpa: null } as never)
    const { account: saved } = await db.service.addPayoutAccount({ actorProfileId: SELLER_ID, seller, details: bankDetails })
    expect(saved.providerBeneficiaryId).toBe('snsb_shared')
  })

  it('rejects details Cashfree marks invalid, and cleans up', async () => {
    const db = setup()
    client.createBeneficiary.mockResolvedValueOnce({ beneficiaryId: 'snsb_bad', status: 'INVALID', bankAccountLast4: null, bankIfsc: null, vpa: null })
    await expect(db.service.addPayoutAccount({ actorProfileId: SELLER_ID, seller, details: bankDetails })).rejects.toMatchObject({ reason: 'details_rejected' })
    expect(client.removeBeneficiary).toHaveBeenCalledWith('snsb_bad')
    expect(db.ledger.accounts).toHaveLength(0)
  })

  it('maps Cashfree failures to plain reasons', async () => {
    const db = setup()
    client.createBeneficiary.mockRejectedValueOnce(new PaymentProviderError('provider_request_failed', 400, 'Invalid IFSC'))
    await expect(db.service.addPayoutAccount({ actorProfileId: SELLER_ID, seller, details: bankDetails })).rejects.toMatchObject({ reason: 'details_rejected' })
    client.createBeneficiary.mockRejectedValueOnce(new PaymentProviderError('provider_request_failed', 403, 'IP not whitelisted'))
    await expect(db.service.addPayoutAccount({ actorProfileId: SELLER_ID, seller, details: bankDetails })).rejects.toMatchObject({ reason: 'setup' })
    client.createBeneficiary.mockRejectedValueOnce(new PaymentProviderError('provider_unreachable'))
    await expect(db.service.addPayoutAccount({ actorProfileId: SELLER_ID, seller, details: bankDetails })).rejects.toBeInstanceOf(PayoutProviderError)
  })

  it('removes details locally and at Cashfree', async () => {
    const db = setup({ accounts: [account()] })
    const { removed } = await db.service.removePayoutAccount({ actorProfileId: SELLER_ID, seller })
    expect(removed?.providerBeneficiaryId).toBe('snsb_existing')
    expect(db.ledger.accounts[0]!.status).toBe('removed')
    expect(client.removeBeneficiary).toHaveBeenCalledWith('snsb_existing')
  })
})

describe('sending a payout', () => {
  it('creates the payout, calls Cashfree with the derived transfer id, and keeps it processing', async () => {
    const db = ready()
    const outcome = await db.service.sendPayout(send)
    expect(outcome.state).toBe('processing')
    expect(client.createTransfer).toHaveBeenCalledWith({ transferId: 'snspo_77777777777747778777777777777777', amountMinor: 62874, beneficiaryId: 'snsb_existing', mode: 'banktransfer' })
    expect(db.ledger.earnings.every((row) => row.status === 'in_payout')).toBe(true)
  })

  it('an immediate success marks everything paid', async () => {
    const db = ready()
    client.createTransfer.mockImplementationOnce(async (input: { transferId: string }) => transfer({ transferId: input.transferId, status: 'SUCCESS', utr: 'UTR42' }))
    const outcome = await db.service.sendPayout(send)
    expect(outcome).toMatchObject({ state: 'success', payout: { utr: 'UTR42' } })
    expect(db.ledger.earnings.every((row) => row.status === 'paid')).toBe(true)
  })

  it('a definite refusal fails the payout and restores the earnings', async () => {
    const db = ready()
    client.createTransfer.mockRejectedValueOnce(new PaymentProviderError('provider_request_failed', 400, 'Beneficiary not found'))
    const outcome = await db.service.sendPayout(send)
    expect(outcome.state).toBe('failed')
    expect(outcome.payout.failureReason).toContain('Beneficiary not found')
    expect(db.ledger.earnings.every((row) => row.status === 'available' && row.payout_id === null)).toBe(true)
  })

  it('an unclear answer (5xx / timeout) keeps the money reserved and asks to check', async () => {
    const db = ready()
    client.createTransfer.mockRejectedValueOnce(new PaymentProviderError('provider_request_failed', 502))
    const outcome = await db.service.sendPayout(send)
    expect(outcome.state).toBe('unconfirmed')
    expect(outcome.payout.status).toBe('draft')
    expect(db.ledger.earnings.every((row) => row.status === 'in_payout')).toBe(true)
  })

  it('a double click does not send twice', async () => {
    const db = ready()
    await db.service.sendPayout(send)
    ids = ['88888888-8888-4888-8888-888888888888']
    const second = await db.service.sendPayout(send)
    expect(second).toMatchObject({ state: 'processing', alreadyOpen: true })
    expect(client.createTransfer).toHaveBeenCalledTimes(1)
    expect(db.ledger.payouts).toHaveLength(1)
  })

  it('a second click while an unclear send is fresh does not call Cashfree again', async () => {
    const db = ready()
    client.createTransfer.mockRejectedValueOnce(new PaymentProviderError('provider_unreachable'))
    await db.service.sendPayout(send)
    const second = await db.service.sendPayout(send)
    expect(second.state).toBe('sending')
    expect(client.getTransfer).toHaveBeenCalledTimes(1)
    expect(client.createTransfer).toHaveBeenCalledTimes(1)
  })

  it('retrying an unclear send first asks Cashfree, and follows its answer', async () => {
    const db = ready()
    client.createTransfer.mockRejectedValueOnce(new PaymentProviderError('provider_unreachable'))
    const first = await db.service.sendPayout(send)
    client.getTransfer.mockResolvedValueOnce(transfer({ transferId: first.payout.transferId, status: 'SUCCESS', utr: 'UTR7' }))
    const retried = await db.service.retryPayout({ actorProfileId: ADMIN_ID, payoutId: first.payout.id })
    expect(retried.state).toBe('success')
    expect(client.createTransfer).toHaveBeenCalledTimes(1)
  })

  it('retrying after the 2-minute window resends with the same transfer id when Cashfree has none', async () => {
    let clock = Date.now()
    const db = ready({ now: () => new Date(clock) })
    client.createTransfer.mockRejectedValueOnce(new PaymentProviderError('provider_unreachable'))
    const first = await db.service.sendPayout(send)
    // The ledger stamped last_dispatch_at with the real time; move our clock 3 minutes on.
    clock += 3 * 60_000
    const retried = await db.service.retryPayout({ actorProfileId: ADMIN_ID, payoutId: first.payout.id })
    expect(retried.state).toBe('processing')
    expect(client.createTransfer).toHaveBeenCalledTimes(2)
    expect(client.createTransfer.mock.calls[1]![0]).toMatchObject({ transferId: first.payout.transferId })
  })

  it('needs Cashfree Payouts to be configured before anything is created', async () => {
    const db = setup({ accounts: [account()], earnings: [earning(E1)] }, { configured: false })
    await expect(db.service.sendPayout({ ...send, earningIds: [E1], expectedTotalMinor: 44910 })).rejects.toBeInstanceOf(PayoutsNotConfiguredError)
    expect(db.ledger.payouts).toHaveLength(0)
  })
})

describe('status checks and cancelling', () => {
  it('refresh applies what Cashfree reports', async () => {
    const db = ready()
    const sent = await db.service.sendPayout(send)
    client.getTransfer.mockResolvedValueOnce(transfer({ transferId: sent.payout.transferId, status: 'FAILED', statusDescription: 'Account frozen' }))
    const refreshed = await db.service.refreshPayoutStatus({ actorProfileId: ADMIN_ID, payoutId: sent.payout.id })
    expect(refreshed.state).toBe('failed')
    expect(db.ledger.earnings.every((row) => row.status === 'available')).toBe(true)
  })

  it('refresh of a draft Cashfree never received says so', async () => {
    const db = ready()
    client.createTransfer.mockRejectedValueOnce(new PaymentProviderError('provider_unreachable'))
    const sent = await db.service.sendPayout(send)
    const refreshed = await db.service.refreshPayoutStatus({ actorProfileId: ADMIN_ID, payoutId: sent.payout.id })
    expect(refreshed.state).toBe('not_at_cashfree')
  })

  it('cancels a stale draft only after Cashfree confirms it has no such transfer', async () => {
    let clock = Date.now()
    const db = ready({ now: () => new Date(clock) })
    client.createTransfer.mockRejectedValueOnce(new PaymentProviderError('provider_unreachable'))
    const sent = await db.service.sendPayout(send)
    await expect(db.service.cancelPayout({ actorProfileId: ADMIN_ID, payoutId: sent.payout.id })).rejects.toMatchObject({ code: 'payout_in_progress' })
    clock += 3 * 60_000
    const cancelled = await db.service.cancelPayout({ actorProfileId: ADMIN_ID, payoutId: sent.payout.id })
    expect(cancelled.state).toBe('cancelled')
    expect(db.ledger.earnings.every((row) => row.status === 'available')).toBe(true)
  })

  it('does not cancel when Cashfree has the transfer after all', async () => {
    let clock = Date.now()
    const db = ready({ now: () => new Date(clock) })
    client.createTransfer.mockRejectedValueOnce(new PaymentProviderError('provider_unreachable'))
    const sent = await db.service.sendPayout(send)
    clock += 3 * 60_000
    client.getTransfer.mockResolvedValueOnce(transfer({ transferId: sent.payout.transferId, status: 'PENDING' }))
    const outcome = await db.service.cancelPayout({ actorProfileId: ADMIN_ID, payoutId: sent.payout.id })
    expect(outcome.state).toBe('processing')
    expect(db.ledger.earnings.every((row) => row.status === 'in_payout')).toBe(true)
  })

  it('refuses to cancel a payout Cashfree is processing', async () => {
    const db = ready()
    const sent = await db.service.sendPayout(send)
    await expect(db.service.cancelPayout({ actorProfileId: ADMIN_ID, payoutId: sent.payout.id })).rejects.toBeInstanceOf(PayoutError)
  })
})
