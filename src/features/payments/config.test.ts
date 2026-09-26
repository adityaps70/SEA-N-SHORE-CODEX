import { describe, expect, it, vi } from 'vitest'
import { loadRazorpayConfig, razorpayConfigFromEnvironment, razorpayConfigFromSecretString } from './config'

const complete = {
  RAZORPAY_KEY_ID: 'rzp_live_Key123',
  RAZORPAY_KEY_SECRET: 'secret',
  RAZORPAY_WEBHOOK_SECRET: 'hook',
}

describe('Razorpay configuration', () => {
  it('reads all three values from the environment', () => {
    expect(razorpayConfigFromEnvironment(complete)).toEqual({ keyId: 'rzp_live_Key123', keySecret: 'secret', webhookSecret: 'hook' })
  })

  it('treats missing or malformed values as not configured', () => {
    expect(razorpayConfigFromEnvironment({})).toBeNull()
    expect(razorpayConfigFromEnvironment({ ...complete, RAZORPAY_WEBHOOK_SECRET: '' })).toBeNull()
    expect(razorpayConfigFromEnvironment({ ...complete, RAZORPAY_KEY_SECRET: '   ' })).toBeNull()
    expect(razorpayConfigFromEnvironment({ ...complete, RAZORPAY_KEY_ID: 'not-a-key' })).toBeNull()
  })

  it('reads a JSON secret from AWS Secrets Manager', () => {
    expect(razorpayConfigFromSecretString(JSON.stringify({ key_id: 'rzp_test_A1', key_secret: 's', webhook_secret: 'w' })))
      .toEqual({ keyId: 'rzp_test_A1', keySecret: 's', webhookSecret: 'w' })
    expect(razorpayConfigFromSecretString('{not json')).toBeNull()
    expect(razorpayConfigFromSecretString(JSON.stringify({ key_id: 'rzp_test_A1' }))).toBeNull()
    expect(razorpayConfigFromSecretString(null)).toBeNull()
  })

  it('prefers environment variables and only calls Secrets Manager when they are missing', async () => {
    const loadSecret = vi.fn(async () => JSON.stringify({ key_id: 'rzp_test_A1', key_secret: 's', webhook_secret: 'w' }))
    await expect(loadRazorpayConfig({ environment: complete, loadSecret, useCache: false })).resolves.toMatchObject({ keyId: 'rzp_live_Key123' })
    expect(loadSecret).not.toHaveBeenCalled()

    await expect(loadRazorpayConfig({
      environment: { PAYMENTS_RAZORPAY_SECRET_ARN: 'arn:aws:secretsmanager:ap-south-1:1:secret:sea-n-shore/razorpay' },
      loadSecret,
      useCache: false,
    })).resolves.toMatchObject({ keyId: 'rzp_test_A1' })
    expect(loadSecret).toHaveBeenCalledWith('arn:aws:secretsmanager:ap-south-1:1:secret:sea-n-shore/razorpay')
  })

  it('returns not configured instead of throwing when the secret cannot be read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(loadRazorpayConfig({
      environment: { PAYMENTS_RAZORPAY_SECRET_ARN: 'missing' },
      loadSecret: async () => { throw new Error('AccessDeniedException') },
      useCache: false,
    })).resolves.toBeNull()
    await expect(loadRazorpayConfig({ environment: {}, useCache: false })).resolves.toBeNull()
    error.mockRestore()
  })

  it('caches the result briefly so each page view does not re-read secrets', async () => {
    const loadSecret = vi.fn(async () => JSON.stringify({ key_id: 'rzp_test_A1', key_secret: 's', webhook_secret: 'w' }))
    const environment = { PAYMENTS_RAZORPAY_SECRET_ARN: 'arn' }
    let now = 1_000
    await loadRazorpayConfig({ environment, loadSecret, now: () => now })
    await loadRazorpayConfig({ environment, loadSecret, now: () => now })
    expect(loadSecret).toHaveBeenCalledTimes(1)
    now += 6 * 60_000
    await loadRazorpayConfig({ environment, loadSecret, now: () => now })
    expect(loadSecret).toHaveBeenCalledTimes(2)
  })
})
