import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cashfree: { pg: null as null | Record<string, unknown>, payouts: null, preferredProvider: null as null | string },
  razorpay: null as null | Record<string, unknown>,
}))

vi.mock('./cashfree-config', async () => {
  const actual = await vi.importActual<typeof import('./cashfree-config')>('./cashfree-config')
  return { ...actual, loadCashfreeSettings: async () => mocks.cashfree }
})
vi.mock('./config', () => ({ loadRazorpayConfig: async () => mocks.razorpay }))

import type { PaymentProviderName } from './types'
import { arePaymentsConfigured, chooseGateway, getGatewayByName, getPaymentCapabilities, getPaymentGateway } from './provider'

const cashfreePg = { clientId: 'TEST1', clientSecret: 's', environment: 'sandbox', international: false }
const razorpayConfig = { keyId: 'rzp_test_A1', keySecret: 's', webhookSecret: 'w' }
const previousProvider = process.env.PAYMENTS_PROVIDER

beforeEach(() => {
  mocks.cashfree = { pg: null, payouts: null, preferredProvider: null }
  mocks.razorpay = null
  delete process.env.PAYMENTS_PROVIDER
})

afterEach(() => {
  if (previousProvider === undefined) delete process.env.PAYMENTS_PROVIDER
  else process.env.PAYMENTS_PROVIDER = previousProvider
})

describe('payment gateway selection', () => {
  const cashfree: { name: PaymentProviderName } = { name: 'cashfree' }
  const razorpay: { name: PaymentProviderName } = { name: 'razorpay' }

  it('defaults to Cashfree, then Razorpay, then none', () => {
    expect(chooseGateway({ cashfree, razorpay, preferred: null })).toBe(cashfree)
    expect(chooseGateway({ cashfree: null, razorpay, preferred: null })).toBe(razorpay)
    expect(chooseGateway({ cashfree: null, razorpay: null, preferred: null })).toBeNull()
  })

  it('honours the owner’s choice only when that gateway is set up', () => {
    expect(chooseGateway({ cashfree, razorpay, preferred: 'razorpay' })).toBe(razorpay)
    expect(chooseGateway({ cashfree, razorpay: null, preferred: 'razorpay' })).toBe(cashfree)
    expect(chooseGateway({ cashfree: null, razorpay, preferred: 'cashfree' })).toBe(razorpay)
  })

  it('stays safely off when nothing is configured', async () => {
    await expect(getPaymentGateway()).resolves.toBeNull()
    await expect(arePaymentsConfigured()).resolves.toBe(false)
    await expect(getPaymentCapabilities()).resolves.toEqual({ configured: false, provider: null, currencies: [] })
  })

  it('uses Cashfree (INR only) when both are set up, and Razorpay when PAYMENTS_PROVIDER says so', async () => {
    mocks.cashfree = { pg: cashfreePg, payouts: null, preferredProvider: null }
    mocks.razorpay = razorpayConfig
    await expect(getPaymentCapabilities()).resolves.toEqual({ configured: true, provider: 'cashfree', currencies: ['INR'] })

    process.env.PAYMENTS_PROVIDER = 'razorpay'
    await expect(getPaymentCapabilities()).resolves.toEqual({ configured: true, provider: 'razorpay', currencies: ['INR', 'USD'] })
  })

  it('reads the preference from the Cashfree secret and allows USD only with the international flag', async () => {
    mocks.cashfree = { pg: { ...cashfreePg, international: true }, payouts: null, preferredProvider: 'razorpay' }
    mocks.razorpay = razorpayConfig
    await expect(getPaymentGateway()).resolves.toMatchObject({ name: 'razorpay' })
    mocks.razorpay = null
    await expect(getPaymentCapabilities()).resolves.toEqual({ configured: true, provider: 'cashfree', currencies: ['INR', 'USD'] })
  })

  it('finds the gateway that created an order, whichever is active', async () => {
    mocks.cashfree = { pg: cashfreePg, payouts: null, preferredProvider: null }
    mocks.razorpay = razorpayConfig
    await expect(getGatewayByName('razorpay')).resolves.toMatchObject({ name: 'razorpay' })
    await expect(getGatewayByName('cashfree')).resolves.toMatchObject({ name: 'cashfree' })
    mocks.razorpay = null
    await expect(getGatewayByName('razorpay')).resolves.toBeNull()
  })
})
