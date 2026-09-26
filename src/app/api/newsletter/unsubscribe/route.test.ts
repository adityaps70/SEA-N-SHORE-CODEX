import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  unsubscribe: vi.fn(),
  getById: vi.fn(),
  syncById: vi.fn(),
  after: [] as Array<() => Promise<void>>,
}))

vi.mock('next/server', () => ({ after: (callback: () => Promise<void>) => { mocks.after.push(callback) } }))
vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/features/newsletter/repository', () => ({
  newsletterRepository: { unsubscribe: mocks.unsubscribe, getById: mocks.getById },
}))
vi.mock('@/features/newsletter/ses-sync', () => ({ createNewsletterSesSync: () => ({ syncById: mocks.syncById }) }))

import { createNewsletterToken } from '@/features/newsletter/tokens'
import { GET, POST } from './route'

const secret = 'test-secret-that-is-at-least-32-characters-long'
const id = '11111111-1111-4111-8111-111111111111'

function oneClick(token: string) {
  return new Request(`https://seanshore.example/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Gmail' },
    body: 'List-Unsubscribe=One-Click',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.after.length = 0
  process.env.NEWSLETTER_TOKEN_SECRET = secret
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('RFC 8058 one-click unsubscribe', () => {
  it('unsubscribes on POST without cookies or login and schedules the SES update', async () => {
    mocks.unsubscribe.mockResolvedValue({ outcome: 'unsubscribed', subscriber: { id, email: 'crew@example.com', status: 'unsubscribed', topics: [] } })
    const response = await POST(oneClick(createNewsletterToken({ subscriberId: id, purpose: 'unsubscribe', secret })))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.unsubscribe).toHaveBeenCalledWith(id, expect.objectContaining({ source: 'one_click' }))
    await mocks.after[0]()
    expect(mocks.syncById).toHaveBeenCalledWith(id)
  })

  it('rejects invalid and expired tokens without touching data', async () => {
    expect((await POST(oneClick('forged.token'))).status).toBe(400)
    const expired = createNewsletterToken({ subscriberId: id, purpose: 'unsubscribe', secret, now: new Date('2020-01-01T00:00:00Z'), ttlSeconds: 1 })
    expect((await POST(oneClick(expired))).status).toBe(410)
    const confirmToken = createNewsletterToken({ subscriberId: id, purpose: 'confirm', secret })
    expect((await POST(oneClick(confirmToken))).status).toBe(400)
    expect(mocks.unsubscribe).not.toHaveBeenCalled()
  })

  it('is idempotent for addresses that already unsubscribed', async () => {
    mocks.unsubscribe.mockResolvedValue({ outcome: 'already_unsubscribed', subscriber: { id, email: 'crew@example.com', status: 'unsubscribed', topics: [] } })
    const response = await POST(oneClick(createNewsletterToken({ subscriberId: id, purpose: 'unsubscribe', secret })))
    expect(response.status).toBe(200)
    expect(mocks.after).toHaveLength(0)
  })

  it('never unsubscribes on GET; it redirects to the confirmation page', async () => {
    const response = await GET(new Request('https://seanshore.example/api/newsletter/unsubscribe?token=abc'))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://seanshore.example/newsletter/unsubscribe?token=abc')
    expect(mocks.unsubscribe).not.toHaveBeenCalled()
  })
})
