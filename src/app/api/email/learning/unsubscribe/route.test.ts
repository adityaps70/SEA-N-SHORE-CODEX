import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ unsubscribeWithToken: vi.fn() }))
vi.mock('@/features/learning/learning-email-sending', () => ({
  createLearningEmailPreferences: () => ({ unsubscribeWithToken: mocks.unsubscribeWithToken }),
}))

import { GET, POST } from './route'

const token = '11111111-1111-4111-8111-111111111111'

describe('/api/email/learning/unsubscribe', () => {
  beforeEach(() => vi.clearAllMocks())

  it('turns learning emails off on the one-click POST, without signing in', async () => {
    mocks.unsubscribeWithToken.mockResolvedValue(true)
    const response = await POST(new Request(`https://seanshore.in/api/email/learning/unsubscribe?token=${token}`, { method: 'POST', body: 'List-Unsubscribe=One-Click' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.unsubscribeWithToken).toHaveBeenCalledWith(token)
  })

  it('answers 404 for a token that is not real', async () => {
    mocks.unsubscribeWithToken.mockResolvedValue(false)
    const response = await POST(new Request('https://seanshore.in/api/email/learning/unsubscribe?token=nope', { method: 'POST' }))
    expect(response.status).toBe(404)
  })

  it('never unsubscribes on GET (link scanners prefetch): it shows the confirmation page', async () => {
    // Behind the load balancer the request carries the container's address; the redirect uses the public site URL.
    const response = await GET(new Request(`http://10.0.1.23:3000/api/email/learning/unsubscribe?token=${token}`))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${process.env.NEXT_PUBLIC_SITE_URL}/email/learning/unsubscribe?token=${token}`)
    expect(mocks.unsubscribeWithToken).not.toHaveBeenCalled()
  })
})
