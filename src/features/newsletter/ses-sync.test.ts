import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))

import { getNewsletterConfig } from './config'
import type { NewsletterSubscriber } from './repository'
import { createSesV2Client, SesApiError } from './ses-client'
import { createNewsletterSesSync, sesTopicPreferences } from './ses-sync'

const config = getNewsletterConfig({
  NEWSLETTER_TOKEN_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  NEWSLETTER_SES_CONTACT_LIST: 'sea-n-shore-newsletter',
  NEWSLETTER_SES_TOPIC_JOBS_DIGEST: 'jobs',
})

function subscriber(overrides: Partial<NewsletterSubscriber> = {}): NewsletterSubscriber {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'crew@example.com',
    profileId: null,
    status: 'subscribed',
    topics: ['product_updates', 'jobs_digest'],
    source: 'newsletter_page',
    consentTextVersion: '2026-09-27',
    consentedAt: null,
    confirmedAt: '2026-09-27T10:00:00.000Z',
    confirmationSentAt: null,
    unsubscribedAt: null,
    sesSyncStatus: 'pending',
    sesSyncAttempts: 0,
    sesSyncError: null,
    sesSyncedAt: null,
    createdAt: '2026-09-27T10:00:00.000Z',
    updatedAt: '2026-09-27T10:00:00.123Z',
    ...overrides,
  }
}

const repository = {
  getById: vi.fn(),
  claimDueForSync: vi.fn(),
  markSynced: vi.fn(async () => true),
  markSyncFailed: vi.fn(async () => true),
  claimForReconcile: vi.fn(),
  unsubscribe: vi.fn(),
  updateTopics: vi.fn(),
}
const ses = { upsertContact: vi.fn(), getContact: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('SES contact-list sync', () => {
  it('upserts subscribed contacts with explicit topic preferences', async () => {
    const sync = createNewsletterSesSync({ repository, ses, config })
    await expect(sync.syncSubscriber(subscriber())).resolves.toBe('synced')
    expect(ses.upsertContact).toHaveBeenCalledWith('sea-n-shore-newsletter', {
      email: 'crew@example.com',
      unsubscribeAll: false,
      topics: [
        { TopicName: 'product-updates', SubscriptionStatus: 'OPT_IN' },
        { TopicName: 'jobs', SubscriptionStatus: 'OPT_IN' },
        { TopicName: 'learning-events', SubscriptionStatus: 'OPT_OUT' },
      ],
    })
    expect(repository.markSynced).toHaveBeenCalledWith(subscriber().id, subscriber().updatedAt)
  })

  it('marks opted-out contacts as unsubscribed from everything in SES', async () => {
    const sync = createNewsletterSesSync({ repository, ses, config })
    await sync.syncSubscriber(subscriber({ status: 'unsubscribed' }))
    expect(ses.upsertContact).toHaveBeenCalledWith('sea-n-shore-newsletter', expect.objectContaining({ unsubscribeAll: true }))
    expect(sesTopicPreferences(config, { status: 'unsubscribed', topics: ['jobs_digest'] }).every((entry) => entry.SubscriptionStatus === 'OPT_OUT')).toBe(true)
  })

  it('keeps the signup and schedules a retry when SES fails', async () => {
    ses.upsertContact.mockRejectedValueOnce(new SesApiError('TooManyRequestsException', 429, 'Rate exceeded'))
    const sync = createNewsletterSesSync({ repository, ses, config })

    await expect(sync.syncSubscriber(subscriber())).resolves.toBe('failed')

    expect(repository.markSyncFailed).toHaveBeenCalledWith(subscriber().id, subscriber().updatedAt, 'TooManyRequestsException: Rate exceeded')
    expect(repository.markSynced).not.toHaveBeenCalled()
    expect(repository.unsubscribe).not.toHaveBeenCalled()
  })

  it('skips without error while no contact list is configured (rows stay pending)', async () => {
    const sync = createNewsletterSesSync({ repository, ses, config: getNewsletterConfig({}) })
    await expect(sync.syncSubscriber(subscriber())).resolves.toBe('skipped')
    await expect(sync.runSyncSweep()).resolves.toMatchObject({ skipped: true })
    expect(ses.upsertContact).not.toHaveBeenCalled()
    expect(repository.markSyncFailed).not.toHaveBeenCalled()
  })

  it('retries due rows in the worker sweep', async () => {
    repository.claimDueForSync.mockResolvedValue([subscriber(), subscriber({ id: '22222222-2222-4222-8222-222222222222' })])
    ses.upsertContact.mockResolvedValueOnce('updated').mockRejectedValueOnce(new Error('network down'))
    const sync = createNewsletterSesSync({ repository, ses, config })
    await expect(sync.runSyncSweep(10)).resolves.toEqual({ claimed: 2, synced: 1, failed: 1, skipped: false })
  })

  it('pulls opt-outs made through SES subscription management back into the database', async () => {
    repository.claimForReconcile.mockResolvedValue([subscriber(), subscriber({ id: '33333333-3333-4333-8333-333333333333' })])
    ses.getContact
      .mockResolvedValueOnce({ UnsubscribeAll: true })
      .mockResolvedValueOnce({ TopicPreferences: [{ TopicName: 'jobs', SubscriptionStatus: 'OPT_OUT' }] })
    const sync = createNewsletterSesSync({ repository, ses, config })

    await expect(sync.runReconcileSweep()).resolves.toEqual({ checked: 2, updated: 2 })
    expect(repository.unsubscribe).toHaveBeenCalledWith(subscriber().id, { source: 'ses_subscription_management' })
    expect(repository.updateTopics).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333', ['product_updates'], { source: 'ses_subscription_management' })
  })
})

describe('SES v2 client', () => {
  const credentials = async () => ({ accessKeyId: 'AKID', secretAccessKey: 'secret' })

  it('creates the contact when updating finds none, with signed requests', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Contact not found' }), { status: 404, headers: { 'x-amzn-ErrorType': 'NotFoundException:http://internal' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const client = createSesV2Client({ region: 'ap-south-1', credentials, fetch })

    await expect(client.upsertContact('news', { email: 'a+b@example.com', topics: [], unsubscribeAll: false })).resolves.toBe('created')

    expect(fetch.mock.calls[0][0]).toBe('https://email.ap-south-1.amazonaws.com/v2/email/contact-lists/news/contacts/a%2Bb%40example.com')
    expect(fetch.mock.calls[0][1].method).toBe('PUT')
    expect(fetch.mock.calls[0][1].headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/ap-south-1\/ses\/aws4_request/)
    expect(fetch.mock.calls[1][1].method).toBe('POST')
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ EmailAddress: 'a+b@example.com', TopicPreferences: [], UnsubscribeAll: false })
  })

  it('raises typed, retry-aware errors', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ __type: 'com.amazon#TooManyRequestsException', message: 'slow down' }), { status: 429 }))
    const client = createSesV2Client({ region: 'ap-south-1', credentials, fetch })
    const error = await client.upsertContact('news', { email: 'x@example.com', topics: [], unsubscribeAll: false }).catch((caught) => caught)
    expect(error).toBeInstanceOf(SesApiError)
    expect(error).toMatchObject({ code: 'TooManyRequestsException', status: 429, retryable: true })
  })

  it('returns null for a missing contact', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 404, headers: { 'x-amzn-ErrorType': 'NotFoundException' } }))
    const client = createSesV2Client({ region: 'ap-south-1', credentials, fetch })
    await expect(client.getContact('news', 'x@example.com')).resolves.toBeNull()
  })
})
