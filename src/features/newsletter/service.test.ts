import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getNewsletterConfig } from './config'
import type { NewsletterSubscriber } from './repository'
import { createNewsletterService, NEWSLETTER_IP_LIMIT_PER_HOUR } from './service'
import { createNewsletterToken } from './tokens'

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))

const secret = 'test-secret-that-is-at-least-32-characters-long'
const config = getNewsletterConfig({ NEWSLETTER_TOKEN_SECRET: secret, NEXT_PUBLIC_SITE_URL: 'https://seanshore.example' })
const id = '11111111-1111-4111-8111-111111111111'

function subscriber(overrides: Partial<NewsletterSubscriber> = {}): NewsletterSubscriber {
  return {
    id,
    email: 'crew@example.com',
    profileId: null,
    status: 'pending',
    topics: ['product_updates'],
    source: 'newsletter_page',
    consentTextVersion: '2026-09-27',
    consentedAt: '2026-09-27T10:00:00.000Z',
    confirmedAt: null,
    confirmationSentAt: null,
    unsubscribedAt: null,
    sesSyncStatus: 'not_required',
    sesSyncAttempts: 0,
    sesSyncError: null,
    sesSyncedAt: null,
    createdAt: '2026-09-27T10:00:00.000Z',
    updatedAt: '2026-09-27T10:00:00.000Z',
    ...overrides,
  }
}

const repository = {
  recordSignup: vi.fn(),
  countRecentEventsForIp: vi.fn(),
  countRecentEventsForEmail: vi.fn(),
  confirm: vi.fn(),
  unsubscribe: vi.fn(),
  updateTopics: vi.fn(),
  getById: vi.fn(),
}

const service = createNewsletterService({ repository, config })

const baseInput = {
  email: 'crew@example.com',
  topics: ['product_updates' as const],
  source: 'newsletter_page' as const,
  viewer: null,
  ipHash: 'a'.repeat(32),
  userAgentSummary: 'Chrome on Android',
}

beforeEach(() => {
  vi.clearAllMocks()
  repository.countRecentEventsForIp.mockResolvedValue(0)
  repository.countRecentEventsForEmail.mockResolvedValue(0)
})

describe('newsletter subscribe', () => {
  it('requires email confirmation for anyone who is not the signed-in owner of the address', async () => {
    repository.recordSignup.mockResolvedValue({ outcome: 'confirmation_required', subscriber: subscriber() })
    const result = await service.subscribe({ ...baseInput, viewer: { profileId: 'p1', verifiedEmail: 'someone-else@example.com' } })

    expect(repository.recordSignup).toHaveBeenCalledWith(expect.objectContaining({ ownershipVerified: false, email: 'crew@example.com' }))
    expect(result).toMatchObject({ ok: true, outcome: 'confirmation_required', followUp: 'confirm' })
    // SES sending is not configured here, so the message must not claim an email was sent.
    expect(result.ok && result.message).toMatch(/is saved\. We'll email a confirmation link/)
  })

  it('subscribes a signed-in member straight away only for their own verified email', async () => {
    repository.recordSignup.mockResolvedValue({ outcome: 'subscribed', subscriber: subscriber({ status: 'subscribed' }) })
    const result = await service.subscribe({ ...baseInput, viewer: { profileId: 'p1', verifiedEmail: 'crew@example.com' } })

    expect(repository.recordSignup).toHaveBeenCalledWith(expect.objectContaining({ ownershipVerified: true, profileId: 'p1' }))
    expect(result).toMatchObject({ ok: true, outcome: 'subscribed', followUp: 'sync' })
    expect(repository.recordSignup.mock.calls[0][0].context).toMatchObject({ consentTextVersion: '2026-09-27', source: 'newsletter_page' })
  })

  it('explains duplicates without changing anything', async () => {
    repository.recordSignup.mockResolvedValue({ outcome: 'already_subscribed', subscriber: subscriber({ status: 'subscribed' }) })
    const result = await service.subscribe(baseInput)
    expect(result).toMatchObject({ ok: true, outcome: 'already_subscribed', followUp: 'none' })
    expect(result.ok && result.message).toMatch(/already subscribed, so nothing has changed/)
  })

  it('rate limits by hashed IP and by address before touching the subscriber table', async () => {
    repository.countRecentEventsForIp.mockResolvedValue(NEWSLETTER_IP_LIMIT_PER_HOUR)
    await expect(service.subscribe(baseInput)).resolves.toMatchObject({ ok: false, code: 'rate_limited' })

    repository.countRecentEventsForIp.mockResolvedValue(0)
    repository.countRecentEventsForEmail.mockResolvedValue(5)
    await expect(service.subscribe(baseInput)).resolves.toMatchObject({ ok: false, code: 'rate_limited' })
    expect(repository.recordSignup).not.toHaveBeenCalled()
  })
})

describe('newsletter token actions', () => {
  it('unsubscribes with a valid token', async () => {
    repository.unsubscribe.mockResolvedValue({ outcome: 'unsubscribed', subscriber: subscriber({ status: 'unsubscribed' }) })
    const token = createNewsletterToken({ subscriberId: id, purpose: 'unsubscribe', secret })
    const result = await service.unsubscribeWithToken(token, { source: 'unsubscribe_page' })
    expect(repository.unsubscribe).toHaveBeenCalledWith(id, { source: 'unsubscribe_page' })
    expect(result).toMatchObject({ ok: true, outcome: 'unsubscribed' })
  })

  it('refuses invalid and expired tokens with an explanation', async () => {
    const expired = createNewsletterToken({ subscriberId: id, purpose: 'unsubscribe', secret, now: new Date('2020-01-01T00:00:00Z'), ttlSeconds: 60 })
    await expect(service.unsubscribeWithToken(expired, { source: 'one_click' })).resolves.toMatchObject({ ok: false, reason: 'expired', message: expect.stringMatching(/expired/) })
    await expect(service.unsubscribeWithToken('garbage', { source: 'one_click' })).resolves.toMatchObject({ ok: false, reason: 'invalid' })
    expect(repository.unsubscribe).not.toHaveBeenCalled()
  })

  it('does not resubscribe an address that unsubscribed after the confirmation email', async () => {
    repository.confirm.mockResolvedValue({ outcome: 'unsubscribed', subscriber: subscriber({ status: 'unsubscribed' }) })
    const token = createNewsletterToken({ subscriberId: id, purpose: 'confirm', secret })
    const result = await service.confirmWithToken(token, {})
    expect(result).toMatchObject({ ok: true, outcome: 'unsubscribed', message: expect.stringMatching(/did not subscribe it again/) })
  })

  it('reports that links are unavailable when the signing secret is not configured', async () => {
    const unconfigured = createNewsletterService({ repository, config: getNewsletterConfig({}) })
    await expect(unconfigured.unsubscribeWithToken('x.y', { source: 'one_click' })).resolves.toMatchObject({ ok: false, reason: 'unavailable' })
  })
})
