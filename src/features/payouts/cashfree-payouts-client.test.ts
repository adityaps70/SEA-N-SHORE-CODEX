import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { PaymentProviderError } from '@/features/payments/types'
import {
  CASHFREE_PAYOUTS_API_VERSION,
  cashfreePayoutSignature,
  createCashfreePayoutsClient,
  isDefiniteRejection,
  mapCashfreeTransfer,
} from './cashfree-payouts-client'

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const config = { clientId: 'CF_PAYOUT_CLIENT', clientSecret: 'cf_payout_secret_value', publicKeyPem: publicKey, environment: 'sandbox' as const }
const now = new Date('2026-09-27T10:00:00.000Z')

function response(status: number, body: unknown) {
  return new Response(body === null ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fakeFetch(...answers: Array<[number, unknown]>) {
  const queue = [...answers]
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    const next = queue.shift()
    if (!next) throw new Error('unexpected request')
    return response(next[0], next[1])
  })
}

function headersOf(call: unknown[]) {
  return (call[1] as RequestInit).headers as Record<string, string>
}

describe('X-Cf-Signature', () => {
  it('is RSA-OAEP (SHA-1) of "clientId.epochSeconds" that the key owner can decrypt', () => {
    const signature = cashfreePayoutSignature('CF_PAYOUT_CLIENT', publicKey, now)
    const decrypted = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(signature, 'base64')).toString('utf8')
    expect(decrypted).toBe(`CF_PAYOUT_CLIENT.${Math.floor(now.getTime() / 1000)}`)
    // OAEP is randomized: a fresh signature per request.
    expect(cashfreePayoutSignature('CF_PAYOUT_CLIENT', publicKey, now)).not.toBe(signature)
  })

  it('uses SHA-1 for OAEP (the Java sample\'s OAEPWithSHA-1AndMGF1Padding), not SHA-256', () => {
    const signature = cashfreePayoutSignature('CF_PAYOUT_CLIENT', publicKey, now)
    expect(() => privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(signature, 'base64'))).toThrow()
  })
})

describe('Cashfree Payouts v2 client', () => {
  it('sends the payouts headers, version and a fresh signature to the sandbox base URL', async () => {
    const fetchImpl = fakeFetch([201, { beneficiary_id: 'snsb_abc', beneficiary_status: 'VERIFIED', beneficiary_instrument_details: { bank_account_number: '00011020001772', bank_ifsc: 'HDFC0000001' } }])
    const client = createCashfreePayoutsClient(config, { fetchImpl, now: () => now })
    const beneficiary = await client.createBeneficiary({ beneficiaryId: 'snsb_abc', name: 'Arjun Rao', bankAccountNumber: '00011020001772', bankIfsc: 'HDFC0000001' })

    expect(beneficiary).toEqual({ beneficiaryId: 'snsb_abc', status: 'VERIFIED', bankAccountLast4: '1772', bankIfsc: 'HDFC0000001', vpa: null })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://sandbox.cashfree.com/payout/beneficiary')
    expect(init?.method).toBe('POST')
    const headers = headersOf(fetchImpl.mock.calls[0]!)
    expect(headers['x-api-version']).toBe(CASHFREE_PAYOUTS_API_VERSION)
    expect(headers['x-api-version']).toBe('2024-01-01')
    expect(headers['x-client-id']).toBe('CF_PAYOUT_CLIENT')
    expect(headers['x-client-secret']).toBe('cf_payout_secret_value')
    expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    const decrypted = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(headers['x-cf-signature']!, 'base64')).toString()
    expect(decrypted).toBe(`CF_PAYOUT_CLIENT.${Math.floor(now.getTime() / 1000)}`)
    expect(JSON.parse(String(init?.body))).toEqual({
      beneficiary_id: 'snsb_abc',
      beneficiary_name: 'Arjun Rao',
      beneficiary_instrument_details: { bank_account_number: '00011020001772', bank_ifsc: 'HDFC0000001' },
    })
  })

  it('omits the signature when IP whitelisting is used (no public key) and uses production when configured', async () => {
    const fetchImpl = fakeFetch([200, { beneficiary_id: 'snsb_abc', beneficiary_status: 'VERIFIED', beneficiary_instrument_details: { vpa: 'success@upi' } }])
    const client = createCashfreePayoutsClient({ ...config, publicKeyPem: null, environment: 'production' }, { fetchImpl })
    await client.getBeneficiary('snsb_abc')
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.cashfree.com/payout/beneficiary?beneficiary_id=snsb_abc')
    expect(headersOf(fetchImpl.mock.calls[0]!)['x-cf-signature']).toBeUndefined()
  })

  it('sends a UPI beneficiary with only the VPA', async () => {
    const fetchImpl = fakeFetch([201, { beneficiary_id: 'snsb_upi', beneficiary_status: 'VERIFIED', beneficiary_instrument_details: { vpa: 'success@upi' } }])
    const client = createCashfreePayoutsClient(config, { fetchImpl })
    await client.createBeneficiary({ beneficiaryId: 'snsb_upi', name: 'Meera Kulkarni', vpa: 'success@upi' })
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)).beneficiary_instrument_details).toEqual({ vpa: 'success@upi' })
  })

  it('reads a missing beneficiary as null and treats an already-removed one as removed', async () => {
    const client = createCashfreePayoutsClient(config, { fetchImpl: fakeFetch([404, { message: 'Beneficiary does not exist' }], [404, { message: 'Beneficiary does not exist' }], [200, { beneficiary_id: 'snsb_x', beneficiary_status: 'DELETED' }]) })
    expect(await client.getBeneficiary('snsb_missing')).toBeNull()
    expect(await client.removeBeneficiary('snsb_missing')).toEqual({ removed: false })
    expect(await client.removeBeneficiary('snsb_x')).toEqual({ removed: true })
  })

  it('creates a standard transfer in rupees with exactly 2 decimals from paise', async () => {
    const fetchImpl = fakeFetch([200, { transfer_id: 'snspo_1', cf_transfer_id: 'CF123', status: 'RECEIVED', status_code: 'RECEIVED', transfer_amount: 1234.56 }])
    const client = createCashfreePayoutsClient(config, { fetchImpl })
    const transfer = await client.createTransfer({ transferId: 'snspo_1', amountMinor: 123456, beneficiaryId: 'snsb_abc', mode: 'banktransfer' })
    expect(transfer).toMatchObject({ transferId: 'snspo_1', cfTransferId: 'CF123', status: 'RECEIVED', amountMinor: 123456 })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://sandbox.cashfree.com/payout/transfers')
    expect(JSON.parse(String(init?.body))).toEqual({
      transfer_id: 'snspo_1',
      transfer_amount: 1234.56,
      transfer_currency: 'INR',
      transfer_mode: 'banktransfer',
      beneficiary_details: { beneficiary_id: 'snsb_abc' },
      transfer_remarks: 'Sea N Shore seller payout',
    })
    expect(String(init?.body)).toContain('"transfer_amount":1234.56')
  })

  it('never sends a second transfer: a duplicate transfer id (409) reads the existing transfer', async () => {
    const fetchImpl = fakeFetch([409, { message: 'Transfer Id already exists' }], [200, { transfer_id: 'snspo_1', cf_transfer_id: 'CF123', status: 'SUCCESS', transfer_utr: 'UTR998877', transfer_amount: '100.00' }])
    const client = createCashfreePayoutsClient(config, { fetchImpl })
    const transfer = await client.createTransfer({ transferId: 'snspo_1', amountMinor: 10000, beneficiaryId: 'snsb_abc', mode: 'upi' })
    expect(transfer).toMatchObject({ status: 'SUCCESS', utr: 'UTR998877', amountMinor: 10000 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1]![0]).toBe('https://sandbox.cashfree.com/payout/transfers?transfer_id=snspo_1')
    expect(fetchImpl.mock.calls[1]![1]?.method).toBe('GET')
  })

  it('reads the transfer status by query (null when Cashfree has none)', async () => {
    const client = createCashfreePayoutsClient(config, { fetchImpl: fakeFetch([404, { message: 'Transfer does not exist' }]) })
    expect(await client.getTransfer('snspo_1')).toBeNull()
  })

  it('refuses invalid ids and amounts below ₹1.00 without calling Cashfree', async () => {
    const fetchImpl = fakeFetch()
    const client = createCashfreePayoutsClient(config, { fetchImpl })
    await expect(client.createTransfer({ transferId: 'bad id!', amountMinor: 10000, beneficiaryId: 'b', mode: 'upi' })).rejects.toBeInstanceOf(PaymentProviderError)
    await expect(client.createTransfer({ transferId: 'snspo_1', amountMinor: 99, beneficiaryId: 'snsb_abc', mode: 'upi' })).rejects.toMatchObject({ providerMessage: 'transfer_amount_invalid' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports network failures as unreachable and keeps secrets out of errors', async () => {
    const client = createCashfreePayoutsClient(config, { fetchImpl: vi.fn(async () => { throw new TypeError('fetch failed') }) })
    const error = await client.getTransfer('snspo_1').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(PaymentProviderError)
    expect((error as PaymentProviderError).code).toBe('provider_unreachable')
    expect(JSON.stringify(error)).not.toContain('cf_payout_secret_value')
  })

  it('fails safely when the configured public key is malformed', async () => {
    const fetchImpl = fakeFetch()
    const client = createCashfreePayoutsClient({ ...config, publicKeyPem: '-----BEGIN PUBLIC KEY-----\nnope\n-----END PUBLIC KEY-----' }, { fetchImpl })
    await expect(client.getTransfer('snspo_1')).rejects.toMatchObject({ status: 401, providerMessage: 'payouts_public_key_invalid' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('classifies definite rejections (transfer not created) apart from unclear answers', () => {
    expect(isDefiniteRejection(new PaymentProviderError('provider_request_failed', 400))).toBe(true)
    expect(isDefiniteRejection(new PaymentProviderError('provider_request_failed', 422))).toBe(true)
    expect(isDefiniteRejection(new PaymentProviderError('provider_request_failed', 403))).toBe(true)
    expect(isDefiniteRejection(new PaymentProviderError('provider_request_failed', 409))).toBe(false)
    expect(isDefiniteRejection(new PaymentProviderError('provider_request_failed', 429))).toBe(false)
    expect(isDefiniteRejection(new PaymentProviderError('provider_request_failed', 502))).toBe(false)
    expect(isDefiniteRejection(new PaymentProviderError('provider_unreachable'))).toBe(false)
  })

  it('rejects a transfer response without an id or status', () => {
    expect(() => mapCashfreeTransfer({ status: 'SUCCESS' })).toThrow(PaymentProviderError)
  })
})
