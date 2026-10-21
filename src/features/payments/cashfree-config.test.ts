import { generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cashfreeSecretId,
  cashfreeSettingsFromEnvironment,
  cashfreeSettingsFromSecretString,
  DEFAULT_CASHFREE_SECRET_ID,
  loadCashfreeConfig,
  loadCashfreePayoutsConfig,
  loadCashfreeSettings,
  normalizePayoutsPublicKey,
  parseCashfreeEnvironment,
  resetCashfreeConfigCache,
} from './cashfree-config'

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PUBLIC_PEM = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const PKCS1_PEM = keys.publicKey.export({ type: 'pkcs1', format: 'pem' }).toString()
const bodyOf = (pem: string) => pem.split('\n').filter((line) => line && !line.startsWith('-----')).join('')

const secretJson = JSON.stringify({
  client_id: 'TEST10123456789',
  client_secret: 'cfsk_ma_test_secret',
  environment: 'sandbox',
  provider: 'cashfree',
  international: true,
  payouts_client_id: 'CF10PAYOUT',
  payouts_client_secret: 'payout-secret',
  payouts_public_key: PUBLIC_PEM.trim().replace(/\n/g, '\\n'),
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
        publicKeyPem: PUBLIC_PEM,
        publicKeyProblem: null,
        environment: 'sandbox',
      },
      preferredProvider: 'cashfree',
    })
    expect(cashfreeSettingsFromSecretString('{broken')).toEqual({ pg: null, payouts: null, preferredProvider: null })
    expect(cashfreeSettingsFromSecretString(JSON.stringify({ cashfree_international: 'true', client_id: 'A12', client_secret: 'b' })).pg?.international).toBe(true)
  })

  it('accepts the Payouts public key however it was pasted, and checks that it is a real RSA public key', () => {
    const singleLine = `-----BEGIN PUBLIC KEY-----${bodyOf(PUBLIC_PEM)}-----END PUBLIC KEY-----`
    for (const pasted of [PUBLIC_PEM, PUBLIC_PEM.replace(/\n/g, '\\n'), PUBLIC_PEM.replace(/\n/g, '\r\n'), singleLine, bodyOf(PUBLIC_PEM), `  ${bodyOf(PUBLIC_PEM).match(/.{1,40}/g)!.join(' ')}  `]) {
      expect(normalizePayoutsPublicKey(pasted)).toEqual({ pem: PUBLIC_PEM, problem: null })
    }
    // The older PKCS#1 form, with or without its BEGIN/END lines.
    expect(normalizePayoutsPublicKey(PKCS1_PEM)).toEqual({ pem: PKCS1_PEM, problem: null })
    expect(normalizePayoutsPublicKey(bodyOf(PKCS1_PEM)).pem).toBe(PKCS1_PEM)
    // Missing is not invalid.
    expect(normalizePayoutsPublicKey('')).toEqual({ pem: null, problem: null })
    expect(normalizePayoutsPublicKey(undefined)).toEqual({ pem: null, problem: null })
  })

  it('reports a key that cannot sign as invalid, never as missing, and never logs it', () => {
    const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    for (const bad of ['-----BEGIN PUBLIC KEY-----\nMIIBIjAN\n-----END PUBLIC KEY-----', bodyOf(PUBLIC_PEM).slice(0, 200), 'not a key at all', privatePem, PUBLIC_PEM.replace('END PUBLIC', 'END RSA PUBLIC')]) {
      expect(normalizePayoutsPublicKey(bad)).toEqual({ pem: null, problem: 'invalid' })
    }
    const settings = cashfreeSettingsFromSecretString(JSON.stringify({ client_id: 'A12', client_secret: 'b', payouts_client_id: 'CF10PAYOUT', payouts_client_secret: 'payout-secret', payouts_public_key: bodyOf(PUBLIC_PEM).slice(0, 200) }))
    expect(settings.payouts).toMatchObject({ publicKeyPem: null, publicKeyProblem: 'invalid' })
    expect(errorSpy).toHaveBeenCalledWith('payments_cashfree_payouts_public_key_invalid')
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(bodyOf(PUBLIC_PEM).slice(0, 40))
  })

  it('a fresh read (Check Cashfree now) refreshes the cached settings, so a newly added key is used at once', async () => {
    resetCashfreeConfigCache()
    const environment = { NODE_ENV: 'production' }
    const before = JSON.stringify({ client_id: 'A12', client_secret: 'b', payouts_client_id: 'CF10PAYOUT', payouts_client_secret: 'payout-secret' })
    const loadSecret = vi.fn(async () => before)
    await expect(loadCashfreePayoutsConfig({ environment, loadSecret })).resolves.toMatchObject({ publicKeyPem: null })
    loadSecret.mockResolvedValue(secretJson)
    await expect(loadCashfreePayoutsConfig({ environment, loadSecret })).resolves.toMatchObject({ publicKeyPem: null })
    await expect(loadCashfreePayoutsConfig({ environment, loadSecret, useCache: false, refreshCache: true })).resolves.toMatchObject({ publicKeyPem: PUBLIC_PEM })
    await expect(loadCashfreePayoutsConfig({ environment, loadSecret })).resolves.toMatchObject({ publicKeyPem: PUBLIC_PEM })
    expect(loadSecret).toHaveBeenCalledTimes(2)
    resetCashfreeConfigCache()
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
