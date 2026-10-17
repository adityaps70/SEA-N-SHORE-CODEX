import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createResendEmailClient,
  DEFAULT_RESEND_ADMIN_SECRET_ID,
  DEFAULT_RESEND_SECRET_ID,
  loadResendAdminApiKey,
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

  it('sends reply_to only when a reply address is given (round H, H7)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'email_789' }))
    const client = createResendEmailClient({ apiKey: 're_test_secret', fetch: fetchMock })

    await client.sendEmail({ from: 'a@b.com', to: 'c@d.com', subject: 'x', text: 'x', html: '<p>x</p>', replyTo: ' operations@example.com ' })
    await client.sendEmail({ from: 'a@b.com', to: 'c@d.com', subject: 'x', text: 'x', html: '<p>x</p>', replyTo: ' ' })

    const first = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(first.reply_to).toBe('operations@example.com')
    const second = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body))
    expect(second).not.toHaveProperty('reply_to')
  })

  it('sends attachments as base64 files and leaves the field out when there are none', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'email_456' }))
    const client = createResendEmailClient({ apiKey: 're_test_secret', fetch: fetchMock })
    const content = Buffer.from('%PDF-1.7 fixture').toString('base64')

    await client.sendEmail({
      from: 'Sea N Shore <billing@mail.seanshore.in>',
      to: 'learner@example.test',
      subject: 'Your invoice',
      text: 'Attached',
      html: '<p>Attached</p>',
      attachments: [{ filename: 'SNS-26-27-000001.pdf', content }, { filename: ' ', content: 'ignored' }],
    })
    await client.sendEmail({ from: 'a@b.com', to: 'c@d.com', subject: 'x', text: 'x', html: '<p>x</p>', attachments: [] })

    const first = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(first.attachments).toEqual([{ filename: 'SNS-26-27-000001.pdf', content }])
    const second = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body))
    expect(second).not.toHaveProperty('attachments')
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

describe('Resend read calls for delivery status', () => {
  it('fetches one email’s last event with a GET and the bearer key', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ object: 'email', id: 'e-1', to: ['A@Example.com'], last_event: 'delivered', created_at: '2026-10-03 10:00:00+00' }))
    const client = createResendEmailClient({ apiKey: 're_test_key', fetch: fetchMock })
    await expect(client.getEmail('e-1')).resolves.toEqual({ id: 'e-1', lastEvent: 'delivered', to: ['A@Example.com'], createdAt: '2026-10-03 10:00:00+00' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails/e-1')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key')
    await expect(client.getEmail('../domains')).rejects.toMatchObject({ code: 'invalid_email_id' })
  })

  it('reports a rate limit as retryable and a sending-only key as not', async () => {
    const limited = createResendEmailClient({ apiKey: 're_test_key', fetch: vi.fn(async () => jsonResponse({ name: 'rate_limit_exceeded', message: 'Too many' }, 429)) })
    await expect(limited.getEmail('e-1')).rejects.toMatchObject({ status: 429, retryable: true })
    const restricted = createResendEmailClient({ apiKey: 're_test_key', fetch: vi.fn(async () => jsonResponse({ name: 'restricted_api_key', message: 'Sending only' }, 401)) })
    await expect(restricted.getEmail('e-1')).rejects.toMatchObject({ status: 401, retryable: false })
  })

  it('pages through the suppression list with limit and after', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      object: 'list',
      has_more: true,
      data: [{ id: 's1', email: 'A@Example.com', origin: 'bounce', source_id: 'e1' }, { id: '', email: 'skip@example.com' }],
    }))
    const client = createResendEmailClient({ apiKey: 're_test_key', fetch: fetchMock })
    await expect(client.listSuppressions({ after: 's0', limit: 500 })).resolves.toEqual({
      data: [{ id: 's1', email: 'a@example.com', origin: 'bounce', sourceId: 'e1' }],
      hasMore: true,
    })
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://api.resend.com/suppressions?limit=100&after=s0')
  })
})

describe('the full-access admin key', () => {
  it('reads sea-n-shore/resend-admin (plaintext) in production, with its own cache, separate from the sending key', async () => {
    const secrets: Record<string, string> = {
      'sea-n-shore/resend': JSON.stringify({ RESEND_API_KEY: 're_sending_only' }),
      'sea-n-shore/resend-admin': 're_full_access',
    }
    const loadSecret = vi.fn(async (id: string) => secrets[id] ?? null)
    const environment = { NODE_ENV: 'production' }
    expect(DEFAULT_RESEND_ADMIN_SECRET_ID).toBe('sea-n-shore/resend-admin')
    // The existing runtime grant is "sea-n-shore/resend*", which covers the admin secret's name.
    expect(DEFAULT_RESEND_ADMIN_SECRET_ID.startsWith(DEFAULT_RESEND_SECRET_ID)).toBe(true)
    await expect(loadResendApiKey({ environment, loadSecret })).resolves.toBe('re_sending_only')
    await expect(loadResendAdminApiKey({ environment, loadSecret })).resolves.toBe('re_full_access')
    await expect(loadResendApiKey({ environment, loadSecret })).resolves.toBe('re_sending_only')
    expect(loadSecret.mock.calls).toEqual([['sea-n-shore/resend'], ['sea-n-shore/resend-admin']])
  })

  it('returns null without logging the key when the admin secret is missing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' })
    await expect(loadResendAdminApiKey({ environment: { NODE_ENV: 'production' }, loadSecret: async () => { throw error }, useCache: false })).resolves.toBeNull()
    expect(log).toHaveBeenCalledWith('resend_admin_secret_unavailable', { name: 'ResourceNotFoundException' })
    log.mockRestore()
    await expect(loadResendAdminApiKey({ environment: { NODE_ENV: 'test' }, useCache: false })).resolves.toBeNull()
  })
})
