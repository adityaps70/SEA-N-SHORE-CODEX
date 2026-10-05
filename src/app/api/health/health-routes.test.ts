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

  // Rewritten in Round 15: the deep check used to stay open until a token was configured and
  // answered 404 otherwise; it now fails closed with 401 whenever the token is missing or wrong.
  it('fails closed with 401 when HEALTH_CHECK_TOKEN is unset or empty', async () => {
    mocks.check.mockResolvedValue(healthy)
    const unset = await home(new Request('https://seanshore.in/api/health/home', { headers: { 'x-health-check-token': 'anything' } }))
    expect(unset.status).toBe(401)
    expect(unset.headers.get('cache-control')).toBe('private, no-store')
    process.env.HEALTH_CHECK_TOKEN = '   '
    expect((await home(new Request('https://seanshore.in/api/health/home'))).status).toBe(401)
    expect((await home(new Request('https://seanshore.in/api/health/home', { headers: { 'x-health-check-token': '' } }))).status).toBe(401)
    expect(mocks.check).not.toHaveBeenCalled()
  })

  it('answers 401 without the token header', async () => {
    process.env.HEALTH_CHECK_TOKEN = 't'.repeat(40)
    mocks.check.mockResolvedValue(healthy)
    const response = await home(new Request('https://seanshore.in/api/health/home'))
    expect(response.status).toBe(401)
    expect(mocks.check).not.toHaveBeenCalled()
  })

  it('answers 401 with a wrong token, including a prefix of the right one, and never echoes it', async () => {
    process.env.HEALTH_CHECK_TOKEN = 't'.repeat(40)
    mocks.check.mockResolvedValue(healthy)
    for (const token of ['wrong', 't'.repeat(39), 't'.repeat(41), 'T'.repeat(40)]) {
      const response = await home(new Request('https://seanshore.in/api/health/home', { headers: { 'x-health-check-token': token } }))
      expect(response.status).toBe(401)
      expect(await response.text()).not.toContain('t'.repeat(10))
    }
    expect(mocks.check).not.toHaveBeenCalled()
  })

  it('runs the deep Home check with the right token', async () => {
    process.env.HEALTH_CHECK_TOKEN = 't'.repeat(40)
    mocks.check.mockResolvedValue(healthy)
    const ok = await home(new Request('https://seanshore.in/api/health/home', { headers: { 'x-health-check-token': 't'.repeat(40) } }))
    expect(ok.status).toBe(200)
    await expect(ok.json()).resolves.toEqual({ status: 'ok', ...healthy })
    expect(ok.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.check).toHaveBeenCalledTimes(1)
  })

  it('keeps liveness public whatever the token configuration', async () => {
    process.env.HEALTH_CHECK_TOKEN = 't'.repeat(40)
    expect(live().status).toBe(200)
  })
})
