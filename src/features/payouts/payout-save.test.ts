import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))

import { createCashfreePayoutsClient } from './cashfree-payouts-client'
import { sellerPayoutErrorMessage } from './payout-messages'
import { parsePayoutAccountInput } from './payout-rules'
import { PayoutProviderError, createPayoutService } from './payout-service'
import { COMPANY_ID, createLedger, SELLER_ID } from './test-ledger'

/**
 * Hotfix P1: saving payout details end to end through the real Cashfree Payouts client, with Cashfree's answers
 * faked at the network. Placeholder details only.
 */

const OTHER_ORG_ADMIN = '88888888-8888-4888-8888-888888888888'
const NEW_ID = '99999999-9999-4999-8999-999999999999'
const config = { clientId: 'CF-PAYOUTS-ID', clientSecret: 'cf-payouts-secret', publicKeyPem: null, environment: 'production' as const }
const bank = { method: 'bank', holderName: 'Arjun Rao', accountNumber: '000110200017', confirmAccountNumber: '000110200017', ifsc: 'HDFC0000001' }
const upi = { method: 'upi', holderName: 'Arjun Rao', vpa: 'arjun.rao@okhdfc' }

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown }

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

let calls: Call[]
let answer: (call: Call) => Response | Promise<Response>

function fakeFetch(url: string, init?: RequestInit) {
  const call = { method: init?.method ?? 'GET', url, headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined }
  calls.push(call)
  return Promise.resolve(answer(call))
}

function created(call: Call) {
  const body = call.body as { beneficiary_id: string; beneficiary_instrument_details: Record<string, string> }
  return json(200, { beneficiary_id: body.beneficiary_id, beneficiary_status: 'VERIFIED', beneficiary_instrument_details: body.beneficiary_instrument_details })
}

function setup(members: Array<{ company_id: string; user_id: string; role: string }> = []) {
  const db = createLedger({ members })
  const log = vi.fn()
  const service = createPayoutService({
    transaction: db.transaction,
    read: db.client,
    loadConfig: async () => config,
    createClient: (value) => createCashfreePayoutsClient(value, { fetchImpl: fakeFetch }),
    newId: () => NEW_ID,
    log,
  })
  return { ...db, service, log }
}

function details(raw: Record<string, unknown>) {
  const parsed = parsePayoutAccountInput(raw)
  if (!parsed.ok) throw new Error('fixture invalid')
  return parsed.input
}

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (value: unknown) => value)
  expect(error).toBeInstanceOf(PayoutProviderError)
  return error as PayoutProviderError
}

beforeEach(() => {
  calls = []
  answer = created
})

describe('saving payout details against Cashfree Payouts (mocked)', () => {
  it('saves a bank account: Payouts v2 fields, the Payouts keys, and only the masked account kept', async () => {
    const db = setup()
    const { account } = await db.service.addPayoutAccount({ actorProfileId: SELLER_ID, seller: { profileId: SELLER_ID }, details: details(bank) })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://api.cashfree.com/payout/beneficiary' })
    expect(calls[0]!.headers).toMatchObject({ 'x-client-id': 'CF-PAYOUTS-ID', 'x-client-secret': 'cf-payouts-secret', 'x-api-version': '2024-01-01' })
    expect(calls[0]!.body).toEqual({
      beneficiary_id: 'snsb_99999999999949998999999999999999',
      beneficiary_name: 'Arjun Rao',
      beneficiary_instrument_details: { bank_account_number: '000110200017', bank_ifsc: 'HDFC0000001' },
    })
    expect(account).toMatchObject({ method: 'bank', last4: '0017', ifsc: 'HDFC0000001' })
    expect(JSON.stringify(db.ledger.accounts)).not.toContain('000110200017')
  })

  it('saves a UPI ID with beneficiary_instrument_details.vpa', async () => {
    const db = setup()
    const { account } = await db.service.addPayoutAccount({ actorProfileId: SELLER_ID, seller: { profileId: SELLER_ID }, details: details(upi) })
    expect((calls[0]!.body as { beneficiary_instrument_details: unknown }).beneficiary_instrument_details).toEqual({ vpa: 'arjun.rao@okhdfc' })
    expect(account).toMatchObject({ method: 'upi', vpa: 'arjun.rao@okhdfc' })
  })

  it('sends the 2FA signature when a Payouts public key is set up (no fixed IP needed)', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const db = setup()
    const service = createPayoutService({
      transaction: db.transaction,
      read: db.client,
      loadConfig: async () => ({ ...config, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() }),
      createClient: (value) => createCashfreePayoutsClient(value, { fetchImpl: fakeFetch }),
      newId: () => NEW_ID,
      log: vi.fn(),
    })
    await service.addPayoutAccount({ actorProfileId: SELLER_ID, seller: { profileId: SELLER_ID }, details: details(upi) })
    expect(calls[0]!.headers['x-cf-signature']).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  it.each([
    ['IP not whitelisted', 403, { message: 'IP not whitelisted your current IP is 13.200.1.2' }, 'ip_not_whitelisted'],
    ['missing signature', 403, { message: 'Signature missing in the request' }, 'signature_missing'],
    ['wrong signature', 401, { message: 'Signature Mismatched' }, 'signature_mismatch'],
    ['wrong keys', 401, { message: 'authentication Failed' }, 'invalid_keys'],
    ['Payouts not activated', 403, { message: 'Payouts product is not activated for this account' }, 'payouts_not_activated'],
  ])('a Cashfree refusal (%s) is "our setup", with a reason code for admins and nothing saved', async (_label, status, body, reason) => {
    answer = () => json(status, body)
    const db = setup()
    const error = await failure(db.service.addPayoutAccount({ actorProfileId: SELLER_ID, seller: { profileId: SELLER_ID }, details: details(upi) }))
    expect(error).toMatchObject({ reason: 'setup', setupReason: reason, status })
    expect(sellerPayoutErrorMessage(error)).toBe("Payout details can't be saved right now because of a setup problem on our side. Nothing was saved. Please try again later.")
    expect(db.ledger.accounts).toHaveLength(0)
  })

  it.each([
    ['an invalid IFSC', bank, { message: 'beneficiary_instrument_details.bank_ifsc : invalid ifsc provided' }, "Cashfree says the IFSC isn't valid."],
    ['an invalid account number', bank, { message: 'Invalid bank_account_number' }, "Cashfree says the bank account number isn't valid for this IFSC."],
    ['an invalid UPI ID', upi, { message: 'beneficiary_instrument_details.vpa : vpa is invalid' }, "Cashfree says this UPI ID isn't valid or isn't active."],
    ['a name Cashfree refuses', upi, { message: 'beneficiary_name : invalid characters' }, "Cashfree didn't accept the account holder's name."],
  ])('Cashfree rejecting %s is shown in plain words, without codes or what was typed', async (_label, input, body, plain) => {
    answer = () => json(422, body)
    const db = setup()
    const error = await failure(db.service.addPayoutAccount({ actorProfileId: SELLER_ID, seller: { profileId: SELLER_ID }, details: details(input) }))
    expect(error.reason).toBe('details_rejected')
    const message = sellerPayoutErrorMessage(error)
    expect(message).toContain(plain)
    expect(message).toMatch(/Nothing was saved\.$/)
    expect(message).not.toMatch(/beneficiary_|_ifsc|\bvpa\b|422|okhdfc|000110200017|HDFC0000001|Arjun/)
    expect(db.ledger.accounts).toHaveLength(0)
  })

  it('a UPI ID Cashfree already has elsewhere is a duplicate, not a setup problem', async () => {
    answer = () => json(409, { message: 'Beneficiary already exists' })
    const db = setup()
    const error = await failure(db.service.addPayoutAccount({ actorProfileId: SELLER_ID, seller: { profileId: SELLER_ID }, details: details(upi) }))
    expect(error.reason).toBe('duplicate_details')
  })

  it.each([
    ['Cashfree is down', () => json(503, { message: 'Service unavailable' })],
    ['the network fails', () => { throw new TypeError('fetch failed') }],
  ])('when %s, the member is asked to try again later and nothing is saved', async (_label, reply) => {
    answer = reply as () => Response
    const db = setup()
    const error = await failure(db.service.addPayoutAccount({ actorProfileId: SELLER_ID, seller: { profileId: SELLER_ID }, details: details(bank) }))
    expect(error.reason).toBe('unavailable')
    expect(sellerPayoutErrorMessage(error)).toMatch(/couldn't reach our payout partner, Cashfree/)
    expect(db.ledger.accounts).toHaveLength(0)
  })
})

describe('payout details for organizations', () => {
  it('an owner or administrator of the organization can save its payout details', async () => {
    for (const role of ['owner', 'administrator']) {
      calls = []
      const db = setup([{ company_id: COMPANY_ID, user_id: SELLER_ID, role }])
      const { account } = await db.service.addPayoutAccount({ actorProfileId: SELLER_ID, seller: { companyId: COMPANY_ID }, details: details({ ...bank, holderName: 'Beacon Marine Services LLP' }) })
      expect(account).toMatchObject({ method: 'bank', last4: '0017' })
      expect((calls[0]!.body as { beneficiary_name: string }).beneficiary_name).toBe('Beacon Marine Services LLP')
    }
  })

  it('a member of another organization (or a recruiter) cannot, and Cashfree is never called', async () => {
    const db = setup([
      { company_id: COMPANY_ID, user_id: SELLER_ID, role: 'owner' },
      { company_id: '77777777-0000-4000-8000-000000000000', user_id: OTHER_ORG_ADMIN, role: 'administrator' },
      { company_id: COMPANY_ID, user_id: '66666666-0000-4000-8000-000000000000', role: 'recruiter' },
    ])
    await expect(db.service.addPayoutAccount({ actorProfileId: OTHER_ORG_ADMIN, seller: { companyId: COMPANY_ID }, details: details(bank) })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(db.service.addPayoutAccount({ actorProfileId: '66666666-0000-4000-8000-000000000000', seller: { companyId: COMPANY_ID }, details: details(bank) })).rejects.toMatchObject({ code: 'forbidden' })
    expect(calls).toHaveLength(0)
    expect(db.ledger.accounts).toHaveLength(0)
  })
})

describe('validation before Cashfree', () => {
  it.each([
    ['UPI format', { ...upi, vpa: 'not-a-upi-id' }, 'vpa', 'Enter a UPI ID like name@bank.'],
    ['IFSC format', { ...bank, ifsc: 'HDFC000001' }, 'ifsc', 'Enter the 11-character IFSC, for example HDFC0001234. You can find it on your cheque book or bank app.'],
    ['account number typed twice', { ...bank, confirmAccountNumber: '000110200018' }, 'confirmAccountNumber', 'The two account numbers do not match. Type the account number again.'],
    ['name in letters and spaces', { ...upi, holderName: 'Arjun R. 2' }, 'holderName', 'Enter the name exactly as it appears on the account, using letters and spaces only (3 to 100 characters, no dots or numbers).'],
  ])('%s is a field error', (_label, raw, field, message) => {
    const parsed = parsePayoutAccountInput(raw)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.fieldErrors[field as keyof typeof parsed.fieldErrors]).toBe(message)
  })
})
