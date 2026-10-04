// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { OTP_CODES_PER_IP_PER_DAY, createOtpIpLimiter } from './otp-ip-limiter'

describe('per-IP OTP limiter', () => {
  it('counts a hashed IP per day with a conditional DynamoDB update', async () => {
    const send = vi.fn<(params: Record<string, unknown>) => Promise<unknown>>(async () => ({}))
    const limiter = createOtpIpLimiter({ tableName: 'otp-limits', send, now: () => 86_400_000 * 20_000 })
    await expect(limiter.consume('203.0.113.7')).resolves.toBe(true)
    const params = send.mock.calls[0]?.[0] as unknown as { Key: { pk: { S: string } }; ExpressionAttributeValues: Record<string, { N: string }> }
    expect(params.Key.pk.S).toMatch(/^otp#ip#[0-9a-f]{32}#d#20000$/)
    expect(params.Key.pk.S).not.toContain('203.0.113.7')
    expect(params.ExpressionAttributeValues[':max']).toEqual({ N: String(OTP_CODES_PER_IP_PER_DAY) })
  })

  it('refuses at the cap and allows when the counter store is down or unconfigured', async () => {
    const capped = createOtpIpLimiter({ tableName: 't', send: vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'ConditionalCheckFailedException' }) }) })
    await expect(capped.consume('203.0.113.7')).resolves.toBe(false)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const down = createOtpIpLimiter({ tableName: 't', send: vi.fn(async () => { throw new Error('timeout') }) })
    await expect(down.consume('203.0.113.7')).resolves.toBe(true)
    await expect(createOtpIpLimiter({ tableName: null }).consume('203.0.113.7')).resolves.toBe(true)
    await expect(createOtpIpLimiter({ tableName: 't', send: vi.fn() }).consume(null)).resolves.toBe(true)
  })
})
