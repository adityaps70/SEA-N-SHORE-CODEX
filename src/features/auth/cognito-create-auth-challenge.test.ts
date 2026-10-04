// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

async function load() {
  return import('../../../infra/aws/app/lambda/cognito-create-auth-challenge.mjs')
}

/** In-memory stand-in for the DynamoDB counters, with the same window semantics. */
function memoryLimiter() {
  const counters = new Map<string, { n: number; expiresAt: number }>()
  const cooldowns = new Map<string, number>()
  return {
    counters,
    async increment(key: string, max: number, windowSeconds: number, now: number) {
      const current = counters.get(key)
      if (!current || current.expiresAt < now) {
        counters.set(key, { n: 1, expiresAt: now + windowSeconds })
        return true
      }
      if (current.n >= max) return false
      current.n += 1
      return true
    },
    async cooldown(key: string, seconds: number, now: number) {
      const until = cooldowns.get(key)
      if (until !== undefined && until > now) return false
      cooldowns.set(key, now + seconds)
      return true
    },
  }
}

function event(phoneNumber = '+919876543210', overrides: Record<string, unknown> = {}) {
  return {
    triggerSource: 'CreateAuthChallenge_Authentication',
    request: { userAttributes: { phone_number: phoneNumber, phone_number_verified: 'true' }, session: [] },
    response: {} as Record<string, unknown>,
    ...overrides,
  }
}

function setup(start = Date.UTC(2026, 9, 4, 10, 0, 0)) {
  let now = start
  const sns = { sendSms: vi.fn(async () => ({})) }
  const limiter = memoryLimiter()
  const logs: string[] = []
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => { logs.push(String(line)) })
  return {
    sns,
    limiter,
    logs,
    advance: (seconds: number) => { now += seconds * 1000 },
    options: { sns, limiter, environment: { ALLOWED_PHONE_CALLING_CODES: '91' }, now: () => now },
  }
}

describe('phone OTP create-challenge limits (Round 14, 1.1)', () => {
  it('sends a transactional code to an allowed number and never logs it', async () => {
    const { createHandler } = await load()
    const t = setup()
    const result = await createHandler(t.options)(event())
    expect(t.sns.sendSms).toHaveBeenCalledTimes(1)
    const code = (result.response.privateChallengeParameters as { answer: string }).answer
    expect(code).toMatch(/^\d{6}$/)
    expect(result.response.challengeMetadata).toBe(`PHONE_OTP:${code}`)
    expect(result.response.publicChallengeParameters).toEqual({ delivery: 'sms' })
    expect(t.logs.join('\n')).not.toContain(code)
    expect(t.logs.join('\n')).not.toContain('9876543210')
  })

  it('refuses numbers outside the allowed calling codes without sending', async () => {
    const { createHandler } = await load()
    const t = setup()
    await expect(createHandler(t.options)(event('+447700900123'))).rejects.toThrow('otp_country_not_allowed')
    await expect(createHandler(t.options)(event('+12025550123'))).rejects.toThrow('otp_country_not_allowed')
    expect(t.sns.sendSms).not.toHaveBeenCalled()
  })

  it('reuses the session code after a wrong answer instead of texting again', async () => {
    const { createHandler } = await load()
    const t = setup()
    const handler = createHandler(t.options)
    const first = await handler(event())
    const code = (first.response.privateChallengeParameters as { answer: string }).answer
    const retry = await handler(event('+919876543210', {
      request: {
        userAttributes: { phone_number: '+919876543210', phone_number_verified: 'true' },
        session: [{ challengeName: 'CUSTOM_CHALLENGE', challengeResult: false, challengeMetadata: `PHONE_OTP:${code}` }],
      },
    }))
    expect((retry.response.privateChallengeParameters as { answer: string }).answer).toBe(code)
    expect(t.sns.sendSms).toHaveBeenCalledTimes(1)
  })

  it('enforces a 45 second cooldown per number', async () => {
    const { createHandler } = await load()
    const t = setup()
    const handler = createHandler(t.options)
    await handler(event())
    t.advance(30)
    await expect(handler(event())).rejects.toThrow('otp_cooldown')
    t.advance(16)
    await expect(handler(event())).resolves.toBeTruthy()
    expect(t.sns.sendSms).toHaveBeenCalledTimes(2)
  })

  it('allows 5 codes per number per hour and 10 per day', async () => {
    const { createHandler } = await load()
    const t = setup()
    const handler = createHandler(t.options)
    for (let index = 0; index < 5; index += 1) {
      await handler(event())
      t.advance(46)
    }
    await expect(handler(event())).rejects.toThrow('otp_rate_limited')
    t.advance(3600)
    for (let index = 0; index < 5; index += 1) {
      await handler(event())
      t.advance(46)
    }
    t.advance(3600)
    await expect(handler(event())).rejects.toThrow('otp_rate_limited')
    expect(t.sns.sendSms).toHaveBeenCalledTimes(10)
  })

  it('allows only 3 codes per day to a number that was never verified', async () => {
    const { createHandler } = await load()
    const t = setup()
    const handler = createHandler(t.options)
    const unverified = () => event('+919000000001', { request: { userAttributes: { phone_number: '+919000000001', phone_number_verified: 'false' }, session: [] } })
    for (let index = 0; index < 3; index += 1) {
      await handler(unverified())
      t.advance(3601)
    }
    await expect(handler(unverified())).rejects.toThrow('otp_rate_limited')
  })

  it('stops all codes at the global hourly cap and logs it for the alarm', async () => {
    const { createHandler, OTP_LIMITS } = await load()
    const t = setup()
    const handler = createHandler(t.options)
    const hour = Math.floor(Date.UTC(2026, 9, 4, 10, 0, 0) / 3600000)
    t.limiter.counters.set(`otp#global#h#${hour}`, { n: OTP_LIMITS.globalPerHour, expiresAt: Number.MAX_SAFE_INTEGER })
    await expect(handler(event('+919111111111'))).rejects.toThrow('otp_rate_limited')
    expect(t.logs.join('\n')).toContain('otp_global_cap_reached')
    expect(t.sns.sendSms).not.toHaveBeenCalled()
  })

  it('fails closed when the limiter is unavailable', async () => {
    const { createHandler } = await load()
    const t = setup()
    const broken = { increment: vi.fn(async () => { throw new Error('dynamo down') }), cooldown: vi.fn(async () => true) }
    await expect(createHandler({ ...t.options, limiter: broken })(event())).rejects.toThrow('otp_limiter_unavailable')
    expect(t.sns.sendSms).not.toHaveBeenCalled()
  })

  it('counts with conditional DynamoDB updates and treats a failed condition as limited', async () => {
    const { createDynamoLimiter } = await load()
    const send = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'ConditionalCheckFailedException' }))
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'ProvisionedThroughputExceededException' }))
    const limiter = createDynamoLimiter({ tableName: 'otp-limits', client: { send } })
    await expect(limiter.increment('k', 5, 3600, 1000)).resolves.toBe(true)
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      TableName: 'otp-limits',
      Key: { pk: { S: 'k' } },
      ConditionExpression: 'attribute_not_exists(n) OR n < :max OR expiresAt < :now',
    })
    await expect(limiter.increment('k', 5, 3600, 1000)).resolves.toBe(false)
    await expect(limiter.increment('k', 5, 3600, 1000)).rejects.toThrow('boom')
  })

  it('reads the allowed calling codes from configuration, defaulting to India', async () => {
    const { allowedCallingCodes, isAllowedPhoneNumber } = await load()
    expect(allowedCallingCodes({} as NodeJS.ProcessEnv)).toEqual(['91'])
    expect(allowedCallingCodes({ ALLOWED_PHONE_CALLING_CODES: '+91, 971 ,x' } as unknown as NodeJS.ProcessEnv)).toEqual(['91', '971'])
    expect(isAllowedPhoneNumber('+971501234567', ['91', '971'])).toBe(true)
    expect(isAllowedPhoneNumber('919876543210', ['91'])).toBe(false)
  })
})
