import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class AwsAuthenticationRequiredError extends Error {
    constructor() {
      super('Authentication required.')
      this.name = 'AwsAuthenticationRequiredError'
    }
  }
  return {
    AwsAuthenticationRequiredError,
    searchMessageRecipients: vi.fn(),
  }
})

vi.mock('@/features/auth/aws-queries', () => ({
  AwsAuthenticationRequiredError: mocks.AwsAuthenticationRequiredError,
}))
vi.mock('@/features/messaging/recipient-queries', () => ({
  searchMessageRecipients: mocks.searchMessageRecipients,
}))

import { GET } from './route'

describe('GET /api/messages/recipients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.searchMessageRecipients.mockResolvedValue({ query: 'anita', recipients: [], connectionCount: 3 })
  })

  it('searches with the query text and never caches the result', async () => {
    const response = await GET(new Request('https://seanshore.example/api/messages/recipients?q=anita'))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ query: 'anita', recipients: [], connectionCount: 3 })
    expect(mocks.searchMessageRecipients).toHaveBeenCalledWith('anita')
  })

  it('returns 401 with plain copy when signed out', async () => {
    mocks.searchMessageRecipients.mockRejectedValueOnce(new mocks.AwsAuthenticationRequiredError())

    const response = await GET(new Request('https://seanshore.example/api/messages/recipients'))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Please sign in again to search your connections.' })
  })

  it('returns a readable error instead of a crash when the lookup fails', async () => {
    mocks.searchMessageRecipients.mockRejectedValueOnce(new Error('connection reset'))

    const response = await GET(new Request('https://seanshore.example/api/messages/recipients?q=x'))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'We could not load your connections right now. Try again in a moment.' })
  })
})
