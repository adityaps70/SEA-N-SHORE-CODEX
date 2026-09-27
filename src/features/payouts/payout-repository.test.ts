import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))

import {
  applyTransferReport,
  canManageSeller,
  cancelDraftPayout,
  claimDispatch,
  createPayout,
  PayoutError,
  removeActivePayoutAccount,
  saveActivePayoutAccount,
} from './payout-repository'
import { transferIdForPayout } from './payout-rules'
import { account, ACCOUNT_ID, ADMIN_ID, COMPANY_ID, createLedger, earning, SELLER_ID } from './test-ledger'

const PAYOUT_ID = '77777777-7777-4777-8777-777777777777'
const E1 = 'e1111111-1111-4111-8111-111111111111'
const E2 = 'e2222222-2222-4222-8222-222222222222'
const ADJ = 'e3333333-3333-4333-8333-333333333333'
const seller = { profileId: SELLER_ID }

function readyLedger() {
  return createLedger({
    accounts: [account()],
    earnings: [earning(E1, { net_minor: 44910 }), earning(E2, { net_minor: 17964 })],
  })
}

async function created(setup = readyLedger()) {
  const result = await createPayout(setup.client, {
    payoutId: PAYOUT_ID, seller, earningIds: [E1, E2], expectedTotalMinor: 62874, minPayoutMinor: 10000, actorProfileId: ADMIN_ID,
  })
  return { setup, result }
}

describe('createPayout', () => {
  it('creates a draft payout, its items and moves the earnings to in_payout in one go', async () => {
    const { setup, result } = await created()
    expect(result.kind).toBe('created')
    if (result.kind !== 'created') return
    expect(result.payout).toMatchObject({ id: PAYOUT_ID, amountMinor: 62874, status: 'draft', transferId: transferIdForPayout(PAYOUT_ID), transferMode: 'banktransfer', approvedBy: ADMIN_ID })
    expect(setup.ledger.earnings.map((row) => [row.status, row.payout_id])).toEqual([['in_payout', PAYOUT_ID], ['in_payout', PAYOUT_ID]])
    expect(setup.ledger.items).toHaveLength(2)
    expect(setup.ledger.audits.map((row) => row.action)).toEqual(['earning_in_payout', 'earning_in_payout', 'payout_approved'])
  })

  it('returns the open payout on a second click instead of creating another', async () => {
    const { setup } = await created()
    const again = await createPayout(setup.client, {
      payoutId: '88888888-8888-4888-8888-888888888888', seller, earningIds: [E1, E2], expectedTotalMinor: 62874, minPayoutMinor: 10000, actorProfileId: ADMIN_ID,
    })
    expect(again.kind).toBe('existing')
    expect(again.payout.id).toBe(PAYOUT_ID)
    expect(setup.ledger.payouts).toHaveLength(1)
  })

  it('refuses when the reviewed earnings or total no longer match (nothing changes)', async () => {
    const setup = readyLedger()
    await expect(createPayout(setup.client, { payoutId: PAYOUT_ID, seller, earningIds: [E1], expectedTotalMinor: 44910, minPayoutMinor: 10000, actorProfileId: ADMIN_ID }))
      .rejects.toMatchObject({ code: 'balance_changed' })
    await expect(createPayout(setup.client, { payoutId: PAYOUT_ID, seller, earningIds: [E1, E2], expectedTotalMinor: 99999, minPayoutMinor: 10000, actorProfileId: ADMIN_ID }))
      .rejects.toMatchObject({ code: 'balance_changed' })
    expect(setup.ledger.payouts).toHaveLength(0)
    expect(setup.ledger.earnings.every((row) => row.status === 'available')).toBe(true)
  })

  it('nets refund adjustments and never pays out zero or less', async () => {
    const setup = createLedger({
      accounts: [account()],
      earnings: [earning(E1, { net_minor: 44910 }), earning(ADJ, { source_type: 'adjustment', net_minor: -44910 })],
    })
    await expect(createPayout(setup.client, { payoutId: PAYOUT_ID, seller, earningIds: [E1, ADJ], expectedTotalMinor: 0, minPayoutMinor: 10000, actorProfileId: ADMIN_ID }))
      .rejects.toMatchObject({ code: 'nothing_to_pay' })
  })

  it('includes a negative adjustment in the payout total', async () => {
    const setup = createLedger({
      accounts: [account()],
      earnings: [earning(E1, { net_minor: 44910 }), earning(E2, { net_minor: 17964 }), earning(ADJ, { source_type: 'adjustment', net_minor: -17964 })],
    })
    const result = await createPayout(setup.client, { payoutId: PAYOUT_ID, seller, earningIds: [E1, E2, ADJ], expectedTotalMinor: 44910, minPayoutMinor: 10000, actorProfileId: ADMIN_ID })
    expect(result.payout.amountMinor).toBe(44910)
    expect(setup.ledger.earnings.every((row) => row.status === 'in_payout')).toBe(true)
  })

  it('enforces the minimum payout and requires payout details', async () => {
    const small = createLedger({ accounts: [account()], earnings: [earning(E1, { net_minor: 9999 })] })
    await expect(createPayout(small.client, { payoutId: PAYOUT_ID, seller, earningIds: [E1], expectedTotalMinor: 9999, minPayoutMinor: 10000, actorProfileId: ADMIN_ID }))
      .rejects.toMatchObject({ code: 'below_minimum' })
    const noAccount = createLedger({ earnings: [earning(E1)] })
    await expect(createPayout(noAccount.client, { payoutId: PAYOUT_ID, seller, earningIds: [E1], expectedTotalMinor: 44910, minPayoutMinor: 10000, actorProfileId: ADMIN_ID }))
      .rejects.toBeInstanceOf(PayoutError)
  })
})

describe('applyTransferReport (Cashfree status -> payout and earnings)', () => {
  it('processing keeps the earnings in the payout', async () => {
    const { setup } = await created()
    const applied = await applyTransferReport(setup.client, { payoutId: PAYOUT_ID, report: { status: 'RECEIVED', cfTransferId: 'CF1', amountMinor: 62874 }, actor: { type: 'admin', profileId: ADMIN_ID }, source: 'send' })
    expect(applied).toMatchObject({ changed: true, from: 'draft', payout: { status: 'processing', cfTransferId: 'CF1' } })
    expect(setup.ledger.earnings.every((row) => row.status === 'in_payout')).toBe(true)
  })

  it('success marks the earnings paid and stores the UTR; a repeat changes nothing', async () => {
    const { setup } = await created()
    const report = { status: 'SUCCESS', statusCode: 'COMPLETED', cfTransferId: 'CF1', utr: 'UTR123456', amountMinor: 62874 }
    const first = await applyTransferReport(setup.client, { payoutId: PAYOUT_ID, report, actor: { type: 'provider' }, source: 'webhook' })
    expect(first).toMatchObject({ changed: true, payout: { status: 'success', utr: 'UTR123456' } })
    expect(setup.ledger.earnings.every((row) => row.status === 'paid')).toBe(true)
    const auditCount = setup.ledger.audits.length
    const second = await applyTransferReport(setup.client, { payoutId: PAYOUT_ID, report, actor: { type: 'provider' }, source: 'webhook' })
    expect(second).toMatchObject({ changed: false, reason: 'terminal' })
    expect(setup.ledger.audits.length).toBe(auditCount)
  })

  it('a definite failure releases the earnings back to available', async () => {
    const { setup } = await created()
    const applied = await applyTransferReport(setup.client, { payoutId: PAYOUT_ID, report: { status: 'FAILED', statusDescription: 'Invalid account number' }, actor: { type: 'provider' }, source: 'webhook' })
    expect(applied).toMatchObject({ changed: true, payout: { status: 'failed', failureReason: 'Invalid account number' } })
    expect(setup.ledger.earnings.map((row) => [row.status, row.payout_id])).toEqual([['available', null], ['available', null]])
    expect(setup.ledger.items.every((item) => item.active === false)).toBe(true)
    // A late success after a failure is ignored.
    const late = await applyTransferReport(setup.client, { payoutId: PAYOUT_ID, report: { status: 'SUCCESS' }, actor: { type: 'provider' }, source: 'webhook' })
    expect(late).toMatchObject({ changed: false, reason: 'terminal' })
    expect(setup.ledger.earnings.every((row) => row.status === 'available')).toBe(true)
  })

  it('a reversal after success puts the paid earnings back to available', async () => {
    const { setup } = await created()
    await applyTransferReport(setup.client, { payoutId: PAYOUT_ID, report: { status: 'SUCCESS', utr: 'UTR1' }, actor: { type: 'provider' }, source: 'webhook' })
    const reversed = await applyTransferReport(setup.client, { payoutId: PAYOUT_ID, report: { status: 'REVERSED', statusDescription: 'Account closed' }, actor: { type: 'provider' }, source: 'webhook' })
    expect(reversed).toMatchObject({ changed: true, from: 'success', payout: { status: 'reversed' } })
    expect(setup.ledger.earnings.every((row) => row.status === 'available' && row.payout_id === null)).toBe(true)
  })

  it('never applies a report whose amount differs from the payout', async () => {
    const { setup } = await created()
    const applied = await applyTransferReport(setup.client, { payoutId: PAYOUT_ID, report: { status: 'SUCCESS', amountMinor: 1 }, actor: { type: 'provider' }, source: 'webhook' })
    expect(applied).toMatchObject({ changed: false, reason: 'amount_mismatch' })
    expect(setup.ledger.payouts[0]!.status).toBe('draft')
    expect(setup.ledger.audits.at(-1)).toMatchObject({ action: 'transfer_amount_mismatch' })
  })

  it('returns null for an unknown payout', async () => {
    const setup = readyLedger()
    expect(await applyTransferReport(setup.client, { payoutId: PAYOUT_ID, report: { status: 'SUCCESS' }, actor: { type: 'provider' }, source: 'webhook' })).toBeNull()
  })
})

describe('claimDispatch and cancelDraftPayout', () => {
  it('lets only one send through within two minutes (double click)', async () => {
    const { setup } = await created()
    expect(await claimDispatch(setup.client, PAYOUT_ID, new Date())).toBeNull()
    const later = new Date(Date.now() + 3 * 60_000)
    expect(await claimDispatch(setup.client, PAYOUT_ID, later)).toMatchObject({ id: PAYOUT_ID, dispatchAttempts: 2 })
  })

  it('cancels only a draft and returns its earnings to available', async () => {
    const { setup } = await created()
    const cancelled = await cancelDraftPayout(setup.client, { payoutId: PAYOUT_ID, actorProfileId: ADMIN_ID, reason: 'Not received by Cashfree' })
    expect(cancelled.status).toBe('cancelled')
    expect(setup.ledger.earnings.every((row) => row.status === 'available')).toBe(true)
    expect(setup.ledger.audits.at(-1)).toMatchObject({ action: 'payout_cancelled', from_status: 'draft', to_status: 'cancelled' })

    const other = await created()
    await applyTransferReport(other.setup.client, { payoutId: PAYOUT_ID, report: { status: 'RECEIVED' }, actor: { type: 'provider' }, source: 'webhook' })
    await expect(cancelDraftPayout(other.setup.client, { payoutId: PAYOUT_ID, actorProfileId: ADMIN_ID, reason: 'x' })).rejects.toMatchObject({ code: 'payout_not_cancellable' })
  })
})

describe('payout accounts', () => {
  it('replaces the active account and audits only masked details', async () => {
    const setup = createLedger({ accounts: [account()] })
    const saved = await saveActivePayoutAccount(setup.client, {
      accountId: '99999999-9999-4999-8999-999999999999', seller, method: 'upi', holderName: 'Arjun Rao', ifsc: null, last4: null, vpa: 'arjun@okhdfc',
      beneficiaryId: 'snsb_new', providerStatus: 'VERIFIED', providerVerified: true, actorProfileId: SELLER_ID,
    })
    expect(saved.replaced?.id).toBe(ACCOUNT_ID)
    expect(setup.ledger.accounts.filter((row) => row.status === 'active').map((row) => row.provider_beneficiary_id)).toEqual(['snsb_new'])
    expect(setup.ledger.audits.map((row) => row.action)).toEqual(['payout_account_replaced', 'payout_account_added'])
    expect(JSON.stringify(setup.ledger.audits)).not.toMatch(/00011020001772/)
  })

  it('refuses to change details while a payout is on its way', async () => {
    const { setup } = await created()
    await expect(removeActivePayoutAccount(setup.client, { seller, actorProfileId: SELLER_ID })).rejects.toMatchObject({ code: 'payout_in_progress' })
    await expect(saveActivePayoutAccount(setup.client, {
      accountId: '99999999-9999-4999-8999-999999999999', seller, method: 'upi', holderName: 'Arjun Rao', ifsc: null, last4: null, vpa: 'a@b',
      beneficiaryId: 'snsb_new', providerStatus: null, providerVerified: false, actorProfileId: SELLER_ID,
    })).rejects.toMatchObject({ code: 'payout_in_progress' })
  })

  it('lets members manage themselves and only owners/administrators manage an organization', async () => {
    const setup = createLedger({ members: [{ company_id: COMPANY_ID, user_id: SELLER_ID, role: 'owner' }, { company_id: COMPANY_ID, user_id: ADMIN_ID, role: 'recruiter' }] })
    expect(await canManageSeller(setup.client, SELLER_ID, { profileId: SELLER_ID })).toBe(true)
    expect(await canManageSeller(setup.client, ADMIN_ID, { profileId: SELLER_ID })).toBe(false)
    expect(await canManageSeller(setup.client, SELLER_ID, { companyId: COMPANY_ID })).toBe(true)
    expect(await canManageSeller(setup.client, ADMIN_ID, { companyId: COMPANY_ID })).toBe(false)
  })
})
