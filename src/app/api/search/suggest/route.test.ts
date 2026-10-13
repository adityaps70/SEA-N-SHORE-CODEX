import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ suggest: vi.fn(), requireAwsUser: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => ({
  AwsAuthenticationRequiredError: class extends Error {},
  requireAwsUser: mocks.requireAwsUser,
}))
vi.mock('@/features/search/search-service', () => ({ searchService: { suggest: mocks.suggest } }))

const { GET } = await import('./route')
const request = (q: string) => new Request(`http://localhost/api/search/suggest?q=${encodeURIComponent(q)}`)

describe('GET /api/search/suggest (round G)', () => {
  beforeEach(() => {
    mocks.suggest.mockReset().mockResolvedValue({ query: 'x', items: [] })
  })

  it('answers 429 over 10 requests a second, then recovers', async () => {
    vi.useFakeTimers()
    mocks.requireAwsUser.mockResolvedValue({ id: 'member-burst' })
    const statuses: number[] = []
    for (let index = 0; index < 11; index += 1) statuses.push((await GET(request(`plac${index}`))).status)
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true)
    expect(statuses[10]).toBe(429)
    vi.advanceTimersByTime(1100)
    expect((await GET(request('placeholder'))).status).toBe(200)
    vi.useRealTimers()
  })

  it('refuses queries over 80 characters and never answers 500', async () => {
    mocks.requireAwsUser.mockResolvedValue({ id: 'member-other' })
    expect((await GET(request('x'.repeat(81)))).status).toBe(400)
    mocks.suggest.mockRejectedValueOnce(new Error('boom'))
    const response = await GET(request('placeholder'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ items: [], partial: true })
  })
})
