import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdministratorUser: vi.fn(),
  exportRows: vi.fn(),
  recordExport: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => ({
  AwsAuthenticationRequiredError: class AwsAuthenticationRequiredError extends Error {},
}))
vi.mock('@/features/admin/access', () => ({ requirePlatformAdministratorUser: mocks.requirePlatformAdministratorUser }))
vi.mock('@/features/newsletter/repository', () => ({
  newsletterRepository: { exportRows: mocks.exportRows, recordExport: mocks.recordExport },
}))

import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'
import { csvCell } from '@/features/newsletter/csv'
import { GET } from './route'

const row = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'crew@example.com',
  profileId: 'p1',
  status: 'subscribed',
  topics: ['product_updates', 'jobs_digest'],
  source: 'newsletter_page',
  consentTextVersion: '2026-09-27',
  consentedAt: '2026-09-27T10:00:00.000Z',
  confirmedAt: '2026-09-27T10:00:00.000Z',
  confirmationSentAt: null,
  unsubscribedAt: null,
  sesSyncStatus: 'synced',
  sesSyncAttempts: 0,
  sesSyncError: null,
  sesSyncedAt: '2026-09-27T10:01:00.000Z',
  createdAt: '2026-09-27T10:00:00.000Z',
  updatedAt: '2026-09-27T10:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePlatformAdministratorUser.mockResolvedValue({ id: 'admin-1' })
  mocks.exportRows.mockResolvedValue([row])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/admin/newsletter/export', () => {
  it('refuses signed-out visitors and non-administrators before reading any data', async () => {
    mocks.requirePlatformAdministratorUser.mockRejectedValueOnce(new AwsAuthenticationRequiredError())
    expect((await GET(new Request('https://seanshore.example/api/admin/newsletter/export'))).status).toBe(401)

    mocks.requirePlatformAdministratorUser.mockRejectedValueOnce(new Error('admin_forbidden'))
    const forbidden = await GET(new Request('https://seanshore.example/api/admin/newsletter/export'))
    expect(forbidden.status).toBe(403)
    await expect(forbidden.json()).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/Only Sea N Shore administrators/) })

    expect(mocks.exportRows).not.toHaveBeenCalled()
  })

  it('exports a filtered CSV for administrators and audits the export', async () => {
    const response = await GET(new Request('https://seanshore.example/api/admin/newsletter/export?status=subscribed&topic=jobs_digest&q=crew'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('content-disposition')).toMatch(/attachment; filename="sea-n-shore-newsletter-subscribers-\d{4}-\d{2}-\d{2}\.csv"/)
    const text = await response.text()
    expect(text).toContain('email,status,topics,source,consent_text_version')
    expect(text).toContain('crew@example.com,subscribed,product_updates;jobs_digest,newsletter_page,2026-09-27')
    expect(mocks.exportRows).toHaveBeenCalledWith({ q: 'crew', status: 'subscribed', topic: 'jobs_digest' })
    expect(mocks.recordExport).toHaveBeenCalledWith('admin-1', 1, { status: 'subscribed', topic: 'jobs_digest', q: true })
  })

  it('ignores unknown filter values', async () => {
    await GET(new Request('https://seanshore.example/api/admin/newsletter/export?status=everyone&topic=spam'))
    expect(mocks.exportRows).toHaveBeenCalledWith({ q: '', status: null, topic: null })
  })

  it('neutralises spreadsheet formulas in exported cells', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('plain')).toBe('plain')
  })
})
