import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<void>>,
  headers: new Map<string, string>([['x-forwarded-for', '203.0.113.9, 10.0.0.1'], ['user-agent', 'Mozilla/5.0 (Linux; Android 14) Chrome/128']]),
  viewer: null as null | { profileId: string; verifiedEmail: string | null },
  repository: {
    recordSignup: vi.fn(),
    countRecentEventsForIp: vi.fn(async () => 0),
    countRecentEventsForEmail: vi.fn(async () => 0),
    confirm: vi.fn(),
    unsubscribe: vi.fn(),
    updateTopics: vi.fn(),
    getById: vi.fn(),
    getByEmail: vi.fn(),
  },
  syncById: vi.fn(),
  sendConfirmation: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: async () => ({ get: (name: string) => mocks.headers.get(name) ?? null }) }))
vi.mock('next/server', () => ({ after: (callback: () => Promise<void>) => { mocks.afterCallbacks.push(callback) } }))
vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('./queries', () => ({ getNewsletterViewer: async () => mocks.viewer }))
vi.mock('./repository', () => ({ newsletterRepository: mocks.repository }))
vi.mock('./ses-sync', () => ({ createNewsletterSesSync: () => ({ syncById: mocks.syncById }) }))
vi.mock('./sending', () => ({ createNewsletterSender: () => ({ sendConfirmation: mocks.sendConfirmation }) }))

import { subscribeToNewsletter, unsubscribeWithNewsletterToken, updateMyNewsletterPreferences } from './actions'
import { createNewsletterToken } from './tokens'

const secret = 'test-secret-that-is-at-least-32-characters-long'
const id = '11111111-1111-4111-8111-111111111111'

function form(entries: Array<[string, string]>) {
  const data = new FormData()
  for (const [key, value] of entries) data.append(key, value)
  return data
}

function subscriber(status: 'pending' | 'subscribed' | 'unsubscribed' = 'subscribed') {
  return { id, email: 'crew@example.com', status, topics: ['product_updates'], updatedAt: '2026-09-27T10:00:00.000Z' }
}

const validSignup: Array<[string, string]> = [
  ['email', ' Crew@Example.com '],
  ['topics', 'product_updates'],
  ['consent', 'yes'],
  ['source', 'public_footer'],
  ['company_website', ''],
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.afterCallbacks.length = 0
  mocks.viewer = null
  process.env.NEWSLETTER_TOKEN_SECRET = secret
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('subscribeToNewsletter', () => {
  it('requires the explicit consent box and never stores anything without it', async () => {
    const state = await subscribeToNewsletter({ status: 'idle' }, form(validSignup.filter(([key]) => key !== 'consent')))
    expect(state.status).toBe('error')
    expect(state.fieldErrors?.consent).toMatch(/Tick the consent box/)
    expect(state.values).toMatchObject({ email: 'Crew@Example.com', consent: false })
    expect(mocks.repository.recordSignup).not.toHaveBeenCalled()
  })

  it('rejects an invalid email address and a missing topic with field messages', async () => {
    const state = await subscribeToNewsletter({ status: 'idle' }, form([['email', 'not-an-email'], ['consent', 'yes']]))
    expect(state.fieldErrors?.email).toBe('Enter a valid email address, like name@example.com.')
    expect(state.fieldErrors?.topics).toBe('Choose at least one topic.')
    expect(mocks.repository.recordSignup).not.toHaveBeenCalled()
  })

  it('stores consent with a normalised email, hashed IP and coarse user agent, then confirms by email', async () => {
    mocks.repository.recordSignup.mockResolvedValue({ outcome: 'confirmation_required', subscriber: subscriber('pending') })
    const state = await subscribeToNewsletter({ status: 'idle' }, form(validSignup))

    expect(state).toMatchObject({ status: 'success', outcome: 'confirmation_required' })
    const call = mocks.repository.recordSignup.mock.calls[0][0]
    expect(call.email).toBe('crew@example.com')
    expect(call.ownershipVerified).toBe(false)
    expect(call.context.source).toBe('public_footer')
    expect(call.context.ipHash).toMatch(/^[0-9a-f]{32}$/)
    expect(call.context.ipHash).not.toContain('203.0.113.9')
    expect(call.context.userAgentSummary).toBe('Chrome on Android')

    await mocks.afterCallbacks[0]()
    expect(mocks.sendConfirmation).toHaveBeenCalledWith(id)
  })

  it('reports a duplicate signup plainly', async () => {
    mocks.repository.recordSignup.mockResolvedValue({ outcome: 'already_subscribed', subscriber: subscriber() })
    const state = await subscribeToNewsletter({ status: 'idle' }, form(validSignup))
    expect(state).toMatchObject({ status: 'success', outcome: 'already_subscribed' })
    expect(state.message).toMatch(/already subscribed, so nothing has changed/)
    expect(mocks.afterCallbacks).toHaveLength(0)
  })

  it('keeps the signup when SES sync fails: the response is still a success and the error is contained', async () => {
    mocks.viewer = { profileId: 'p1', verifiedEmail: 'crew@example.com' }
    mocks.repository.recordSignup.mockResolvedValue({ outcome: 'subscribed', subscriber: { ...subscriber(), sesSyncStatus: 'pending' } })
    mocks.syncById.mockRejectedValue(new Error('SES unavailable'))

    const state = await subscribeToNewsletter({ status: 'idle' }, form(validSignup))

    expect(state).toMatchObject({ status: 'success', outcome: 'subscribed' })
    expect(mocks.repository.recordSignup.mock.calls[0][0].ownershipVerified).toBe(true)
    await expect(mocks.afterCallbacks[0]()).resolves.toBeUndefined()
    expect(mocks.syncById).toHaveBeenCalledWith(id)
  })

  it('shows a clear error, and keeps what was typed, when the database is unavailable', async () => {
    mocks.repository.recordSignup.mockRejectedValue(new Error('connect ECONNREFUSED'))
    const state = await subscribeToNewsletter({ status: 'idle' }, form(validSignup))
    expect(state.status).toBe('error')
    expect(state.message).toBe("We couldn't save your newsletter choice just now, so nothing was changed. Please try again in a minute.")
    expect(state.values).toMatchObject({ email: 'Crew@Example.com', topics: ['product_updates'], consent: true })
  })

  it('accepts but ignores honeypot submissions from bots', async () => {
    const state = await subscribeToNewsletter({ status: 'idle' }, form([...validSignup.filter(([key]) => key !== 'company_website'), ['company_website', 'http://spam.example']]))
    expect(state.status).toBe('success')
    expect(mocks.repository.recordSignup).not.toHaveBeenCalled()
  })

  it('passes on rate limiting as a message', async () => {
    mocks.repository.countRecentEventsForIp.mockResolvedValueOnce(99)
    const state = await subscribeToNewsletter({ status: 'idle' }, form(validSignup))
    expect(state).toMatchObject({ status: 'error', message: expect.stringMatching(/Too many sign-up attempts/) })
  })
})

describe('unsubscribe and preferences', () => {
  it('unsubscribes from a signed link without login and queues SES sync', async () => {
    mocks.repository.unsubscribe.mockResolvedValue({ outcome: 'unsubscribed', subscriber: subscriber('unsubscribed') })
    const token = createNewsletterToken({ subscriberId: id, purpose: 'unsubscribe', secret })
    const state = await unsubscribeWithNewsletterToken({ status: 'idle' }, form([['token', token]]))
    expect(state).toMatchObject({ status: 'success', outcome: 'unsubscribed' })
    expect(mocks.repository.unsubscribe).toHaveBeenCalledWith(id, expect.objectContaining({ source: 'unsubscribe_page' }))
    expect(mocks.afterCallbacks).toHaveLength(1)
  })

  it('explains an invalid link', async () => {
    const state = await unsubscribeWithNewsletterToken({ status: 'idle' }, form([['token', 'broken']]))
    expect(state).toMatchObject({ status: 'error', message: expect.stringMatching(/not valid/) })
  })

  it('lets a signed-in member change topics only for their own verified address', async () => {
    mocks.viewer = { profileId: 'p1', verifiedEmail: 'crew@example.com' }
    mocks.repository.getByEmail.mockResolvedValue(subscriber())
    mocks.repository.updateTopics.mockResolvedValue({ outcome: 'updated', subscriber: subscriber() })
    const state = await updateMyNewsletterPreferences({ status: 'idle' }, form([['intent', 'save'], ['topics', 'jobs_digest']]))
    expect(state).toMatchObject({ status: 'success', message: 'Your newsletter topics are saved.' })
    expect(mocks.repository.getByEmail).toHaveBeenCalledWith('crew@example.com')
    expect(mocks.repository.updateTopics).toHaveBeenCalledWith(id, ['jobs_digest'], expect.objectContaining({ source: 'member_settings', actorProfileId: 'p1' }))
  })

  it('asks signed-out visitors to sign in instead of failing silently', async () => {
    const state = await updateMyNewsletterPreferences({ status: 'idle' }, form([['intent', 'unsubscribe']]))
    expect(state).toMatchObject({ status: 'error', message: expect.stringMatching(/session has expired/) })
  })
})
