import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  requireAdmin: vi.fn(),
  service: {
    addPayoutAccount: vi.fn(),
    removePayoutAccount: vi.fn(),
    sendPayout: vi.fn(),
    refreshPayoutStatus: vi.fn(),
    retryPayout: vi.fn(),
    cancelPayout: vi.fn(),
  },
  withTransaction: vi.fn(),
  updatePlatformFeeSettings: vi.fn(),
  setSellerFeeOverride: vi.fn(),
  updatePayoutSettings: vi.fn(),
  getPayout: vi.fn(),
  getSellerIdentity: vi.fn(),
  lookupIfsc: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: mocks.withTransaction }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/admin/access', () => ({ requirePlatformAdministratorUser: mocks.requireAdmin }))
vi.mock('@/features/payments/earnings', () => ({
  updatePlatformFeeSettings: mocks.updatePlatformFeeSettings,
  setSellerFeeOverride: mocks.setSellerFeeOverride,
  removeSellerFeeOverride: vi.fn(),
}))
vi.mock('./payout-runtime', () => ({ payoutService: mocks.service, readClient: {} }))
vi.mock('./ifsc-lookup', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), lookupIfsc: mocks.lookupIfsc }))
vi.mock('./payout-queries', () => ({ getSellerIdentity: mocks.getSellerIdentity, searchSellers: vi.fn(async () => []) }))
vi.mock('./payout-repository', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPayout: mocks.getPayout,
  getPayoutSettings: vi.fn(async () => ({ minPayoutMinor: 10000 })),
  updatePayoutSettings: mocks.updatePayoutSettings,
}))

import { lookupIfscAction, removePayoutAccountAction, savePayoutAccountAction } from './actions'
import { cancelPayoutAction, searchSellersAction, sendPayoutAction, setFeeOverrideAction, updateFeeSettingsAction } from './admin-actions'
import { PayoutError } from './payout-repository'
import { PayoutProviderError, PayoutsNotConfiguredError } from './payout-service'

const USER = '44444444-4444-4444-8444-444444444444'
const COMPANY = '55555555-5555-4555-8555-555555555555'
const E1 = 'e1111111-1111-4111-8111-111111111111'
const PAYOUT = '77777777-7777-4777-8777-777777777777'
const bank = { method: 'bank', holderName: 'Arjun Rao', accountNumber: '00011020001772', confirmAccountNumber: '00011020001772', ifsc: 'hdfc0000001' }

function payout(overrides: Record<string, unknown> = {}) {
  return { id: PAYOUT, seller: { profileId: USER }, amountMinor: 62874, status: 'processing', utr: null, failureReason: null, transferId: 'snspo_x', ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.requireAwsUser.mockResolvedValue({ id: USER, cognitoSub: 's', email: 'arjun@example.net' })
  mocks.requireAdmin.mockResolvedValue({ id: 'admin-1', cognitoSub: 'a', email: 'admin@example.net' })
  mocks.withTransaction.mockImplementation(async (work: (tx: unknown) => unknown) => work({}))
  mocks.getSellerIdentity.mockResolvedValue({ seller: { profileId: USER }, name: 'Arjun Rao', slug: 'arjun', kind: 'profile' })
  mocks.lookupIfsc.mockResolvedValue({ status: 'found', bank: 'HDFC Bank', branch: 'Fort', city: 'Mumbai' })
})

describe('seller payout detail actions', () => {
  it('validates before contacting Cashfree and returns field errors', async () => {
    const result = await savePayoutAccountAction(`profile:${USER}`, { ...bank, confirmAccountNumber: '1' })
    expect(result).toMatchObject({ ok: false, fieldErrors: { confirmAccountNumber: expect.stringMatching(/do not match/) } })
    expect(mocks.service.addPayoutAccount).not.toHaveBeenCalled()
  })

  it('saves for the signed-in member and answers with masked details only', async () => {
    mocks.service.addPayoutAccount.mockResolvedValue({ account: { method: 'bank', holderName: 'Arjun Rao', ifsc: 'HDFC0000001', last4: '1772', vpa: null }, replaced: false })
    const result = await savePayoutAccountAction(`profile:${USER}`, bank)
    expect(mocks.service.addPayoutAccount).toHaveBeenCalledWith({ actorProfileId: USER, seller: { profileId: USER }, details: expect.objectContaining({ ifsc: 'HDFC0000001', accountNumber: '00011020001772' }) })
    expect(result).toEqual({ ok: true, account: expect.objectContaining({ summary: 'Bank account ••••1772 · HDFC0000001' }), message: 'Payout details saved. Payouts will go to Bank account ••••1772 · HDFC0000001.' })
    expect(JSON.stringify(result)).not.toContain('00011020001772')
  })

  it('explains refusals in plain words', async () => {
    mocks.service.addPayoutAccount.mockRejectedValueOnce(new PayoutError('forbidden'))
    expect(await savePayoutAccountAction(`company:${COMPANY}`, bank)).toMatchObject({ ok: false, error: expect.stringMatching(/own or administer/) })
    mocks.service.addPayoutAccount.mockRejectedValueOnce(new PayoutsNotConfiguredError())
    expect(await savePayoutAccountAction(`profile:${USER}`, bank)).toMatchObject({ ok: false, error: expect.stringMatching(/not switched on yet/) })
    mocks.service.addPayoutAccount.mockRejectedValueOnce(new PayoutProviderError('details_rejected'))
    expect(await savePayoutAccountAction(`profile:${USER}`, bank)).toMatchObject({ ok: false, error: expect.stringMatching(/couldn't accept these payout details/) })
    mocks.service.addPayoutAccount.mockRejectedValueOnce(new Error('boom'))
    expect(await savePayoutAccountAction(`profile:${USER}`, bank)).toMatchObject({ ok: false, error: expect.stringMatching(/Nothing was changed/) })
  })

  it('stops an IFSC that does not exist before Cashfree, but saves when the IFSC service is down', async () => {
    mocks.lookupIfsc.mockResolvedValueOnce({ status: 'not_found' })
    expect(await savePayoutAccountAction(`profile:${USER}`, bank)).toMatchObject({ ok: false, fieldErrors: { ifsc: expect.stringMatching(/couldn't find this IFSC/) } })
    expect(mocks.service.addPayoutAccount).not.toHaveBeenCalled()
    mocks.lookupIfsc.mockResolvedValueOnce({ status: 'unavailable', bank: 'HDFC Bank' })
    mocks.service.addPayoutAccount.mockResolvedValue({ account: { method: 'bank', holderName: 'Arjun Rao', ifsc: 'HDFC0000001', last4: '1772', vpa: null }, replaced: false })
    expect(await savePayoutAccountAction(`profile:${USER}`, bank)).toMatchObject({ ok: true })
  })

  it('looks up the bank for an IFSC for signed-in members', async () => {
    expect(await lookupIfscAction('hdfc0000001')).toEqual({ ok: true, bank: 'HDFC Bank · Fort, Mumbai', found: true })
    expect(mocks.lookupIfsc).toHaveBeenCalledWith('HDFC0000001')
    mocks.lookupIfsc.mockResolvedValueOnce({ status: 'not_found' })
    expect(await lookupIfscAction('HDFC0999999')).toEqual({ ok: true, bank: null, found: false })
    expect(await lookupIfscAction('HDFC1')).toMatchObject({ ok: false })
  })

  it('logs only reason codes and statuses: never the details, the name or Cashfree\'s text', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const upi = { method: 'upi', holderName: 'Arjun Rao', vpa: 'arjun.rao@okhdfc' }
    mocks.service.addPayoutAccount.mockRejectedValueOnce(new PayoutProviderError('setup', 'IP not whitelisted your current IP is 13.200.1.2', 403))
    expect(await savePayoutAccountAction(`profile:${USER}`, bank)).toMatchObject({ ok: false, error: expect.stringMatching(/setup problem on our side/) })
    mocks.service.addPayoutAccount.mockRejectedValueOnce(new PayoutProviderError('details_rejected', 'vpa arjun.rao@okhdfc is invalid', 422))
    expect(await savePayoutAccountAction(`profile:${USER}`, upi)).toMatchObject({ ok: false, error: expect.stringMatching(/UPI ID isn't valid/) })
    mocks.service.addPayoutAccount.mockRejectedValueOnce(new PayoutProviderError('unavailable', null, 503))
    await savePayoutAccountAction(`profile:${USER}`, bank)
    mocks.service.addPayoutAccount.mockRejectedValueOnce(new PayoutsNotConfiguredError())
    await savePayoutAccountAction(`profile:${USER}`, bank)

    const logged = JSON.stringify([...errors.mock.calls, ...warnings.mock.calls])
    expect(errors).toHaveBeenCalledWith('payout_account_save_failed', { kind: 'setup', reason: 'ip_not_whitelisted', status: 403 })
    expect(warnings).toHaveBeenCalledWith('payout_account_save_failed', { kind: 'rejected', reason: 'details_rejected', status: 422 })
    expect(errors).toHaveBeenCalledWith('payout_account_save_failed', { kind: 'unavailable', status: 503 })
    expect(errors).toHaveBeenCalledWith('payout_account_save_failed', { kind: 'setup', reason: 'payouts_not_configured' })
    for (const secret of ['00011020001772', 'HDFC0000001', 'hdfc0000001', 'arjun.rao@okhdfc', 'Arjun Rao', 'arjun@example.net', '13.200.1.2', 'current IP', 'is invalid']) {
      expect(logged).not.toContain(secret)
    }
  })

  it('rejects a malformed seller key and removes details', async () => {
    expect(await savePayoutAccountAction('company:nope', bank)).toMatchObject({ ok: false })
    mocks.service.removePayoutAccount.mockResolvedValue({ removed: { id: 'a' } })
    expect(await removePayoutAccountAction(`profile:${USER}`)).toMatchObject({ ok: true, message: expect.stringMatching(/removed/) })
    mocks.service.removePayoutAccount.mockRejectedValueOnce(new PayoutError('payout_in_progress'))
    expect(await removePayoutAccountAction(`profile:${USER}`)).toMatchObject({ ok: false, error: expect.stringMatching(/on its way/) })
  })
})

describe('admin payment actions', () => {
  it('only platform administrators can send or change fees', async () => {
    mocks.requireAdmin.mockRejectedValue(new Error('admin_forbidden'))
    expect(await sendPayoutAction({ sellerKey: `profile:${USER}`, earningIds: [E1], expectedTotalMinor: 44910 })).toEqual({ ok: false, error: 'Only Sea N Shore platform administrators can do this.' })
    expect(await updateFeeSettingsAction({ defaultPercent: '10', holdDays: '7', minPayout: '100' })).toMatchObject({ ok: false, error: expect.stringMatching(/platform administrators/) })
    expect(await setFeeOverrideAction({ sellerKey: `profile:${USER}`, percent: '5' })).toMatchObject({ ok: false, error: expect.stringMatching(/platform administrators/) })
    expect(await searchSellersAction('arj')).toMatchObject({ ok: false })
    expect(await cancelPayoutAction(PAYOUT)).toMatchObject({ ok: false, error: expect.stringMatching(/platform administrators/) })
    expect(mocks.service.sendPayout).not.toHaveBeenCalled()
    expect(mocks.updatePlatformFeeSettings).not.toHaveBeenCalled()
  })

  it('sends a reviewed payout and describes the result', async () => {
    mocks.service.sendPayout.mockResolvedValue({ state: 'processing', payout: payout() })
    const result = await sendPayoutAction({ sellerKey: `profile:${USER}`, earningIds: [E1], expectedTotalMinor: 62874 })
    expect(mocks.service.sendPayout).toHaveBeenCalledWith({ actorProfileId: 'admin-1', seller: { profileId: USER }, earningIds: [E1], expectedTotalMinor: 62874 })
    expect(result).toEqual({ ok: true, state: 'processing', payoutId: PAYOUT, message: expect.stringContaining('₹628.74 is on its way to Arjun Rao') })
  })

  it('refuses stale or malformed reviews and maps payout errors', async () => {
    expect(await sendPayoutAction({ sellerKey: `profile:${USER}`, earningIds: ['x'], expectedTotalMinor: 1 })).toMatchObject({ ok: false, error: expect.stringMatching(/out of date/) })
    mocks.service.sendPayout.mockRejectedValueOnce(new PayoutError('balance_changed'))
    expect(await sendPayoutAction({ sellerKey: `profile:${USER}`, earningIds: [E1], expectedTotalMinor: 1 })).toMatchObject({ ok: false, error: expect.stringMatching(/balance changed/) })
    mocks.service.sendPayout.mockRejectedValueOnce(new PayoutError('below_minimum'))
    expect(await sendPayoutAction({ sellerKey: `profile:${USER}`, earningIds: [E1], expectedTotalMinor: 1 })).toMatchObject({ ok: false, error: expect.stringContaining('₹100.00') })
  })

  it('validates fee settings and saves them in one transaction', async () => {
    expect(await updateFeeSettingsAction({ defaultPercent: '101', holdDays: '7', minPayout: '100' })).toMatchObject({ ok: false, fieldErrors: { defaultPercent: expect.any(String) } })
    expect(await updateFeeSettingsAction({ defaultPercent: '10', holdDays: '-1', minPayout: '0.5' })).toMatchObject({ ok: false, fieldErrors: { holdDays: expect.any(String), minPayout: expect.any(String) } })
    mocks.updatePlatformFeeSettings.mockResolvedValue({ defaultPercent: '12.50', holdDays: 10 })
    mocks.updatePayoutSettings.mockResolvedValue({ minPayoutMinor: 25000 })
    const saved = await updateFeeSettingsAction({ defaultPercent: '12.5', holdDays: '10', minPayout: '250' })
    expect(saved).toMatchObject({ ok: true, message: expect.stringContaining('12.5% platform fee') })
    expect(mocks.updatePayoutSettings).toHaveBeenCalledWith({}, { minPayoutMinor: 25000, actorProfileId: 'admin-1' })
    expect(mocks.withTransaction).toHaveBeenCalledTimes(1)
  })

  it('cancels through the service and reports the outcome', async () => {
    mocks.getPayout.mockResolvedValue(payout({ status: 'draft' }))
    mocks.service.cancelPayout.mockResolvedValue({ state: 'cancelled', payout: payout({ status: 'cancelled' }) })
    expect(await cancelPayoutAction(PAYOUT)).toMatchObject({ ok: true, state: 'cancelled', message: expect.stringContaining('back in Arjun Rao') })
    mocks.service.cancelPayout.mockRejectedValueOnce(new PayoutProviderError('unavailable'))
    expect(await cancelPayoutAction(PAYOUT)).toMatchObject({ ok: false, error: expect.stringMatching(/couldn't reach Cashfree/) })
    expect(await cancelPayoutAction('not-a-uuid')).toMatchObject({ ok: false })
  })
})
