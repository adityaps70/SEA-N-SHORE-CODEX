import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cashfreeSecretId,
  cashfreeSettingsFromEnvironment,
  cashfreeSettingsFromSecretString,
  DEFAULT_CASHFREE_SECRET_ID,
  loadCashfreeConfig,
  loadCashfreePayoutsConfig,
  loadCashfreeSettings,
  parseCashfreeEnvironment,
} from './cashfree-config'

const secretJson = JSON.stringify({
  client_id: 'TEST10123456789',
  client_secret: 'cfsk_ma_test_secret',
  environment: 'sandbox',
  provider: 'cashfree',
  international: true,
  payouts_client_id: 'CF10PAYOUT',
  payouts_client_secret: 'payout-secret',
  payouts_public_key: '-----BEGIN PUBLIC KEY-----\\nMIIBIjAN\\n-----END PUBLIC KEY-----',
})

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined) })
afterEach(() => { errorSpy.mockRestore() })

describe('Cashfree configuration', () => {
  it('reads the gateway keys, environment and flags from environment variables', () => {
    expect(cashfreeSettingsFromEnvironment({
      CASHFREE_CLIENT_ID: 'TEST10123456789',
      CASHFREE_CLIENT_SECRET: 'secret',
      CASHFREE_ENVIRONMENT: 'production',
      CASHFREE_INTERNATIONAL: 'true',
      PAYMENTS_PROVIDER: 'razorpay',
    })).toEqual({
      pg: { clientId: 'TEST10123456789', clientSecret: 'secret', environment: 'production', international: true },
      payouts: null,
      preferredProvider: 'razorpay',
    })
  })

  it('defaults to the sandbox and to INR only, and refuses an unknown environment', () => {
    expect(cashfreeSettingsFromEnvironment({ CASHFREE_CLIENT_ID: 'TEST1', CASHFREE_CLIENT_SECRET: 's' })?.pg)
      .toEqual({ clientId: 'TEST1', clientSecret: 's', environment: 'sandbox', international: false })
    expect(cashfreeSettingsFromEnvironment({ CASHFREE_CLIENT_ID: 'TEST1', CASHFREE_CLIENT_SECRET: 's', CASHFREE_ENVIRONMENT: 'staging' })).toBeNull()
    expect(parseCashfreeEnvironment('LIVE')).toBe('production')
    expect(parseCashfreeEnvironment('test')).toBe('sandbox')
    expect(cashfreeSettingsFromEnvironment({})).toBeNull()
    expect(cashfreeSettingsFromEnvironment({ CASHFREE_CLIENT_ID: 'TEST1', CASHFREE_CLIENT_SECRET: '  ' })).toBeNull()
  })

  it('reads the JSON secret, including payouts keys for the payouts module', () => {
    expect(cashfreeSettingsFromSecretString(secretJson)).toEqual({
      pg: { clientId: 'TEST10123456789', clientSecret: 'cfsk_ma_test_secret', environment: 'sandbox', international: true },
      payouts: {
        clientId: 'CF10PAYOUT',
        clientSecret: 'payout-secret',
        publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIBIjAN\n-----END PUBLIC KEY-----',
        environment: 'sandbox',
      },
      preferredProvider: 'cashfree',
    })
    expect(cashfreeSettingsFromSecretString('{broken')).toEqual({ pg: null, payouts: null, preferredProvider: null })
    expect(cashfreeSettingsFromSecretString(JSON.stringify({ cashfree_international: 'true', client_id: 'A12', client_secret: 'b' })).pg?.international).toBe(true)
  })

  it('uses the explicit secret ARN, or the default secret name in production only', () => {
    expect(cashfreeSecretId({ PAYMENTS_CASHFREE_SECRET_ARN: 'arn:aws:secretsmanager:ap-south-1:1:secret:x' })).toBe('arn:aws:secretsmanager:ap-south-1:1:secret:x')
    expect(cashfreeSecretId({ NODE_ENV: 'production' })).toBe(DEFAULT_CASHFREE_SECRET_ID)
    expect(DEFAULT_CASHFREE_SECRET_ID).toBe('sea-n-shore/staging/cashfree')
    expect(cashfreeSecretId({ NODE_ENV: 'development' })).toBeNull()
  })

  it('prefers environment keys and only reads Secrets Manager when they are missing, caching the answer', async () => {
    const loadSecret = vi.fn(async () => secretJson)
    const fromEnv = await loadCashfreeSettings({
      environment: { CASHFREE_CLIENT_ID: 'TEST1', CASHFREE_CLIENT_SECRET: 's', NODE_ENV: 'production' },
      loadSecret,
      useCache: false,
    })
    expect(fromEnv.pg?.clientId).toBe('TEST1')
    expect(loadSecret).not.toHaveBeenCalled()

    let clock = 1_000
    const environment = { NODE_ENV: 'production' }
    await expect(loadCashfreeConfig({ environment, loadSecret, now: () => clock })).resolves.toMatchObject({ clientId: 'TEST10123456789' })
    await expect(loadCashfreePayoutsConfig({ environment, loadSecret, now: () => clock })).resolves.toMatchObject({ clientId: 'CF10PAYOUT' })
    expect(loadSecret).toHaveBeenCalledTimes(1)
    expect(loadSecret).toHaveBeenCalledWith(DEFAULT_CASHFREE_SECRET_ID)
    clock += 6 * 60_000
    await loadCashfreeConfig({ environment, loadSecret, now: () => clock })
    expect(loadSecret).toHaveBeenCalledTimes(2)
  })

  it('treats an unreadable secret as "not set up" and logs only the error name', async () => {
    const denied = Object.assign(new Error('User is not authorized to perform secretsmanager:GetSecretValue with key cfsk_ma_leak'), { name: 'AccessDeniedException' })
    const settings = await loadCashfreeSettings({
      environment: { PAYMENTS_CASHFREE_SECRET_ARN: 'sea-n-shore/staging/cashfree' },
      loadSecret: async () => { throw denied },
      useCache: false,
    })
    expect(settings.pg).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith('payments_cashfree_secret_unavailable', { name: 'AccessDeniedException' })
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('cfsk_ma_leak')
  })

  it('does nothing outside production when no secret is named', async () => {
    const loadSecret = vi.fn(async () => secretJson)
    await expect(loadCashfreeConfig({ environment: {}, loadSecret, useCache: false })).resolves.toBeNull()
    expect(loadSecret).not.toHaveBeenCalled()
  })
})
