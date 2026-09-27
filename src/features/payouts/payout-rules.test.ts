import { describe, expect, it } from 'vitest'
import {
  beneficiaryIdFor,
  formatExactMoney,
  formatPercentLabel,
  isPayoutTransferId,
  maskPayoutAccount,
  maskVpa,
  minorToRupeesInput,
  nextPayoutStatus,
  parsePayoutAccountInput,
  parseRupeesToMinor,
  parseSellerKey,
  payoutIdFromTransferId,
  sellerKey,
  transferIdForPayout,
  transferOutcome,
} from './payout-rules'

const payoutId = '7f3c2a10-1b2c-4d5e-8f90-a1b2c3d4e5f6'

describe('payout identifiers', () => {
  it('derives a Cashfree-safe transfer id from the payout id and back', () => {
    const transferId = transferIdForPayout(payoutId)
    expect(transferId).toBe('snspo_7f3c2a101b2c4d5e8f90a1b2c3d4e5f6')
    expect(transferId).toMatch(/^[A-Za-z0-9_]{3,40}$/)
    expect(isPayoutTransferId(transferId)).toBe(true)
    expect(payoutIdFromTransferId(transferId)).toBe(payoutId)
    expect(payoutIdFromTransferId('evt_123')).toBeNull()
    expect(() => transferIdForPayout('not-a-uuid')).toThrow('payout_id_invalid')
  })

  it('derives a beneficiary id within Cashfree limits', () => {
    const id = beneficiaryIdFor(payoutId)
    expect(id).toMatch(/^snsb_[0-9a-f]{32}$/)
    expect(id.length).toBeLessThanOrEqual(50)
  })

  it('round-trips seller keys and rejects anything else', () => {
    expect(sellerKey({ profileId: payoutId })).toBe(`profile:${payoutId}`)
    expect(parseSellerKey(`company:${payoutId.toUpperCase()}`)).toEqual({ companyId: payoutId })
    expect(parseSellerKey(`profile:${payoutId}`)).toEqual({ profileId: payoutId })
    expect(parseSellerKey('company:1; drop table')).toBeNull()
    expect(parseSellerKey('admin:' + payoutId)).toBeNull()
    expect(parseSellerKey(undefined)).toBeNull()
  })
})

describe('payout details validation', () => {
  it('accepts a bank account, normalizing spaces and IFSC case', () => {
    const result = parsePayoutAccountInput({ method: 'bank', holderName: '  Arjun   Rao ', accountNumber: '0001 1020 0017 72', confirmAccountNumber: '00011020001772', ifsc: 'hdfc0000001' })
    expect(result).toEqual({ ok: true, input: { method: 'bank', holderName: 'Arjun Rao', accountNumber: '00011020001772', confirmAccountNumber: '00011020001772', ifsc: 'HDFC0000001' } })
  })

  it('explains each bank field problem', () => {
    const result = parsePayoutAccountInput({ method: 'bank', holderName: 'Capt. Rao', accountNumber: '12ab', confirmAccountNumber: '999', ifsc: 'HDFC1234567' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.fieldErrors.holderName).toMatch(/letters and spaces only/)
    expect(result.fieldErrors.accountNumber).toMatch(/digits only/)
    expect(result.fieldErrors.ifsc).toMatch(/11-character IFSC/)
  })

  it('requires the account number twice', () => {
    const result = parsePayoutAccountInput({ method: 'bank', holderName: 'Arjun Rao', accountNumber: '00011020001772', confirmAccountNumber: '00011020001773', ifsc: 'HDFC0000001' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.fieldErrors.confirmAccountNumber).toMatch(/do not match/)
  })

  it('accepts a UPI ID (lower-cased) and rejects a malformed one', () => {
    expect(parsePayoutAccountInput({ method: 'upi', holderName: 'Meera Kulkarni', vpa: ' Meera.K@OKHDFC ' })).toEqual({ ok: true, input: { method: 'upi', holderName: 'Meera Kulkarni', vpa: 'meera.k@okhdfc' } })
    const bad = parsePayoutAccountInput({ method: 'upi', holderName: 'Meera Kulkarni', vpa: 'meera' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.fieldErrors.vpa).toMatch(/UPI ID like name@bank/)
  })

  it('asks for a method when none is chosen', () => {
    const result = parsePayoutAccountInput({ method: 'cash', holderName: 'Arjun Rao' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.fieldErrors.method).toBe('Choose bank account or UPI ID.')
  })
})

describe('masking', () => {
  it('never shows more than the last 4 digits or the start of a UPI handle', () => {
    expect(maskPayoutAccount({ method: 'bank', holderName: 'Arjun Rao', ifsc: 'HDFC0000001', last4: '1772', vpa: null }).summary).toBe('Bank account ••••1772 · HDFC0000001')
    expect(maskVpa('meera.k@okhdfc')).toBe('me•••@okhdfc')
    expect(maskPayoutAccount({ method: 'upi', holderName: 'Meera', ifsc: null, last4: null, vpa: 'meera.k@okhdfc' }).summary).toBe('UPI me•••@okhdfc')
  })
})

describe('transfer status mapping and state machine', () => {
  it('maps Cashfree statuses; anything unknown stays processing', () => {
    expect(transferOutcome('SUCCESS')).toBe('success')
    expect(transferOutcome('sent_to_beneficiary')).toBe('success')
    for (const status of ['FAILED', 'REJECTED', 'MANUALLY_REJECTED']) expect(transferOutcome(status)).toBe('failed')
    expect(transferOutcome('REVERSED')).toBe('reversed')
    for (const status of ['RECEIVED', 'QUEUED', 'PENDING', 'APPROVAL_PENDING', 'VALIDATION_PENDING', 'SOMETHING_NEW', null]) expect(transferOutcome(status)).toBe('processing')
  })

  it('only allows forward moves; terminal payouts never change except success -> reversed', () => {
    expect(nextPayoutStatus('draft', 'processing')).toBe('processing')
    expect(nextPayoutStatus('draft', 'success')).toBe('success')
    expect(nextPayoutStatus('processing', 'failed')).toBe('failed')
    expect(nextPayoutStatus('processing', 'reversed')).toBe('reversed')
    expect(nextPayoutStatus('success', 'reversed')).toBe('reversed')
    expect(nextPayoutStatus('success', 'failed')).toBeNull()
    expect(nextPayoutStatus('success', 'processing')).toBeNull()
    expect(nextPayoutStatus('failed', 'success')).toBeNull()
    expect(nextPayoutStatus('cancelled', 'success')).toBeNull()
    expect(nextPayoutStatus('reversed', 'success')).toBeNull()
  })
})

describe('money formatting', () => {
  it('shows rupees with 2 decimals and a real minus sign', () => {
    expect(formatExactMoney(10000)).toBe('₹100.00')
    expect(formatExactMoney(12345678)).toBe('₹1,23,456.78')
    expect(formatExactMoney(-4491)).toBe('−₹44.91')
    expect(formatExactMoney(0)).toBe('₹0.00')
  })

  it('parses typed rupee amounts exactly into paise', () => {
    expect(parseRupeesToMinor('100')).toBe(10000)
    expect(parseRupeesToMinor('₹1,000.5')).toBe(100050)
    expect(parseRupeesToMinor('0.29')).toBe(29)
    expect(parseRupeesToMinor('1.234')).toBeNull()
    expect(parseRupeesToMinor('-5')).toBeNull()
    expect(minorToRupeesInput(10000)).toBe('100')
    expect(minorToRupeesInput(10050)).toBe('100.50')
  })

  it('labels percentages compactly', () => {
    expect(formatPercentLabel('10.00')).toBe('10%')
    expect(formatPercentLabel('12.50')).toBe('12.5%')
    expect(formatPercentLabel('7.25')).toBe('7.25%')
  })
})
