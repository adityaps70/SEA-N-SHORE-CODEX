import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getVerifiedUser: vi.fn(),
  canUsePlatformAdminAuthority: vi.fn(),
  exportCsv: vi.fn(),
}))

vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))
vi.mock('@/features/admin/mfa-gate', () => ({ canUsePlatformAdminAuthority: mocks.canUsePlatformAdminAuthority }))
vi.mock('@/features/learning/company-training/dashboard-repository', () => ({ trainingDashboardRepository: { exportCsv: mocks.exportCsv } }))

import { SeatError } from '@/features/learning/company-training/seat-rules'
import { GET } from './route'

const companyId = '55555555-5555-4555-8555-555555555555'

function get(headers: Record<string, string> = {}, id = companyId) {
  return GET(new Request(`https://seanshore.example/api/organizations/${id}/training/export`, { headers }), { params: Promise.resolve({ companyId: id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.getVerifiedUser.mockResolvedValue({ id: 'user-1', email: 'fixture@example.test' })
  mocks.canUsePlatformAdminAuthority.mockResolvedValue(false)
  mocks.exportCsv.mockResolvedValue('Learner,Vessel\r\nFixture Learner,Fixture Vessel\r\n')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/organizations/[companyId]/training/export', () => {
  it('answers a router prefetch or a browser speculative prefetch with an empty 204 and exports nothing (owner 21 Nov)', async () => {
    for (const headers of [{ rsc: '1' }, { 'next-router-prefetch': '1' }, { 'sec-purpose': 'prefetch' }, { purpose: 'prefetch' }] as Record<string, string>[]) {
      const response = await get(headers)
      expect(response.status).toBe(204)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(await response.text()).toBe('')
    }
    expect(mocks.getVerifiedUser).not.toHaveBeenCalled()
    expect(mocks.canUsePlatformAdminAuthority).not.toHaveBeenCalled()
    expect(mocks.exportCsv).not.toHaveBeenCalled()
  })

  it('downloads the crew training as a private CSV attachment', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-10T08:00:00.000Z'))

    const response = await get()

    expect(response.status).toBe(200)
    expect(mocks.exportCsv).toHaveBeenCalledWith({ actorId: 'user-1' }, companyId)
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="sea-n-shore-crew-training-2026-10-10.csv"')
    expect(await response.text()).toBe('Learner,Vessel\r\nFixture Learner,Fixture Vessel\r\n')
  })

  it('asks signed-out visitors to sign in before reading anything', async () => {
    mocks.getVerifiedUser.mockResolvedValue(null)
    const response = await get()
    expect(response.status).toBe(401)
    expect(mocks.exportCsv).not.toHaveBeenCalled()
  })

  it('is not found for a company id that is not a UUID', async () => {
    const response = await get({}, 'not-a-company')
    expect(response.status).toBe(404)
    expect(mocks.exportCsv).not.toHaveBeenCalled()
  })

  it('lets a platform administrator export a company they do not run', async () => {
    mocks.exportCsv.mockRejectedValueOnce(new SeatError('company_training_not_allowed'))
    mocks.canUsePlatformAdminAuthority.mockResolvedValue(true)

    const response = await get()

    expect(response.status).toBe(200)
    expect(mocks.exportCsv).toHaveBeenLastCalledWith({ actorId: 'user-1', platformAdmin: true }, companyId)
  })

  it('is not found for anyone else who does not run the company', async () => {
    mocks.exportCsv.mockRejectedValue(new SeatError('company_training_not_allowed'))
    const response = await get()
    expect(response.status).toBe(404)
    expect(mocks.exportCsv).toHaveBeenCalledTimes(1)
  })
})
