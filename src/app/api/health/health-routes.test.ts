// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ check: vi.fn() }))
vi.mock('@/lib/db/home-health', () => ({ checkHomeRuntimeHealth: mocks.check }))

import { GET as live } from './live/route'
import { GET as home } from './home/route'

const healthy = { profile: true, network: true, discovery: true, feed: true, hydration: true, media: true }

describe('health routes (Round 14, 1.5)', () => {
  afterEach(() => { delete process.env.HEALTH_CHECK_TOKEN; vi.clearAllMocks() })

  it('answers liveness without touching the database', async () => {
    const response = live()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.check).not.toHaveBeenCalled()
  })

  it('keeps the deep Home check open until a token is configured', async () => {
    mocks.check.mockResolvedValue(healthy)
    const response = await home(new Request('https://seanshore.in/api/health/home'))
    expect(response.status).toBe(200)
  })

  it('requires the configured token for the deep Home check', async () => {
    process.env.HEALTH_CHECK_TOKEN = 't'.repeat(40)
    mocks.check.mockResolvedValue(healthy)
    expect((await home(new Request('https://seanshore.in/api/health/home'))).status).toBe(404)
    expect((await home(new Request('https://seanshore.in/api/health/home', { headers: { 'x-health-check-token': 'wrong' } }))).status).toBe(404)
    expect(mocks.check).not.toHaveBeenCalled()
    const ok = await home(new Request('https://seanshore.in/api/health/home', { headers: { 'x-health-check-token': 't'.repeat(40) } }))
    expect(ok.status).toBe(200)
  })
})
