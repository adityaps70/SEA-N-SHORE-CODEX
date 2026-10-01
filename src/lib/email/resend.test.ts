import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createResendEmailClient,
  DEFAULT_RESEND_SECRET_ID,
  loadResendApiKey,
  resendApiKeyFromSecretString,
  resendSecretId,
  resetResendApiKeyCache,
  ResendApiError,
} from './resend'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => resetResendApiKeyCache())

describe('Resend email client', () => {
  it('sends through the REST API with auth, headers, tags and idempotency', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'email_123' }))
    const client = createResendEmailClient({ apiKey: 're_test_secret', fetch: fetchMock })

    await expect(client.sendEmail({
      from: 'Sea N Shore <newsletter@mail.seanshore.in>',
      to: 'crew@example.com',
      subject: 'Welcome aboard',
      text: 'Hello',
      html: '<p>Hello</p>',
      headers: [
        { Name: 'List-Unsubscribe', Value: '<https://seanshore.in/unsubscribe>' },
        { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
      ],
      tags: [{ name: 'category', value: 'newsletter_confirmation' }],
      idempotencyKey: 'newsletter-confirmation/user-1',
    })).resolves.toEqual({ messageId: 'email_123' })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.cache).toBe('no-store')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer re_test_secret',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'newsletter-confirmation/user-1',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'Sea N Shore <newsletter@mail.seanshore.in>',
      to: ['crew@example.com'],
      subject: 'Welcome aboard',
      text: 'Hello',
      html: '<p>Hello</p>',
      headers: {
        'List-Unsubscribe': '<https://seanshore.in/unsubscribe>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      tags: [{ name: 'category', value: 'newsletter_confirmation' }],
    })
  })

  it('classifies network, rate-limit and server failures as retryable without leaking the API key', async () => {
    const rateClient = createResendEmailClient({
      apiKey: 're_super_secret',
      fetch: vi.fn(async () => jsonResponse({ name: 'rate_limit_exceeded', message: 'Too many requests' }, 429)),
    })
    await expect(rateClient.sendEmail({ from: 'a@b.com', to: 'c@d.com', subject: 'x', text: 'x', html: '<p>x</p>' }))
      .rejects.toMatchObject({ name: 'ResendApiError', code: 'rate_limit_exceeded', status: 429, retryable: true })

    const serverClient = createResendEmailClient({
      apiKey: 're_super_secret',
      fetch: vi.fn(async () => jsonResponse({ message: 'temporary failure' }, 503)),
    })
    await expect(serverClient.sendEmail({ from: 'a@b.com', to: 'c@d.com', subject: 'x', text: 'x', html: '<p>x</p>' }))
      .rejects.toMatchObject({ retryable: true })

    const networkClient = createResendEmailClient({
      apiKey: 're_super_secret',
      fetch: vi.fn(async () => { throw new Error('socket failed with re_super_secret') }),
    })
    const error = await networkClient.sendEmail({ from: 'a@b.com', to: 'c@d.com', subject: 'x', text: 'x', html: '<p>x</p>' }).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(ResendApiError)
    expect(error).toMatchObject({ code: 'network_error', status: 0, retryable: true })
    expect(String(error instanceof Error ? error.message : error)).not.toContain('re_super_secret')
  })

  it('reads the API key from environment first, then the production Secrets Manager JSON secret', async () => {
    const loadSecret = vi.fn(async () => JSON.stringify({ RESEND_API_KEY: 're_from_secret' }))
    await expect(loadResendApiKey({
      environment: { RESEND_API_KEY: ' re_from_env ', NODE_ENV: 'production' },
      loadSecret,
      useCache: false,
    })).resolves.toBe('re_from_env')
    expect(loadSecret).not.toHaveBeenCalled()

    let clock = 1000
    const environment = { NODE_ENV: 'production' }
    await expect(loadResendApiKey({ environment, loadSecret, now: () => clock })).resolves.toBe('re_from_secret')
    await expect(loadResendApiKey({ environment, loadSecret, now: () => clock })).resolves.toBe('re_from_secret')
    expect(loadSecret).toHaveBeenCalledTimes(1)
    expect(loadSecret).toHaveBeenCalledWith(DEFAULT_RESEND_SECRET_ID)
    clock += 6 * 60_000
    await loadResendApiKey({ environment, loadSecret, now: () => clock })
    expect(loadSecret).toHaveBeenCalledTimes(2)
  })

  it('uses the explicit secret id or the production default and parses only plausible Resend keys', () => {
    expect(DEFAULT_RESEND_SECRET_ID).toBe('sea-n-shore/resend')
    expect(resendSecretId({ RESEND_SECRET_ID: 'arn:aws:secretsmanager:ap-south-1:1:secret:custom' }))
      .toBe('arn:aws:secretsmanager:ap-south-1:1:secret:custom')
    expect(resendSecretId({ NODE_ENV: 'production' })).toBe(DEFAULT_RESEND_SECRET_ID)
    expect(resendSecretId({ NODE_ENV: 'development' })).toBeNull()
    expect(resendApiKeyFromSecretString(JSON.stringify({ RESEND_API_KEY: 're_json_key' }))).toBe('re_json_key')
    expect(resendApiKeyFromSecretString(JSON.stringify({ api_key: 're_alt_key' }))).toBe('re_alt_key')
    expect(resendApiKeyFromSecretString('re_raw_key')).toBe('re_raw_key')
    expect(resendApiKeyFromSecretString(JSON.stringify({ RESEND_API_KEY: 'not-a-key' }))).toBeNull()
  })
})
