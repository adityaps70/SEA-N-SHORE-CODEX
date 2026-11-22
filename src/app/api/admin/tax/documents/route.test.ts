import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdministratorUser: vi.fn(),
  listGstDocumentsForMonth: vi.fn(),
  recordPaymentAudit: vi.fn(),
  client: { query: vi.fn() },
}))

vi.mock('@/lib/db/client', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (work: (client: unknown) => Promise<unknown>) => work(mocks.client)),
}))
vi.mock('@/features/auth/aws-queries', () => ({
  AwsAuthenticationRequiredError: class AwsAuthenticationRequiredError extends Error {},
}))
vi.mock('@/features/admin/access', () => ({ requirePlatformAdministratorUser: mocks.requirePlatformAdministratorUser }))
vi.mock('@/features/payments/audit', () => ({ recordPaymentAudit: mocks.recordPaymentAudit }))
vi.mock('@/features/tax/gst-export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/tax/gst-export')>()),
  listGstDocumentsForMonth: mocks.listGstDocumentsForMonth,
}))

import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'
import { GET } from './route'

const row = {
  documentType: 'Invoice',
  number: 'SNS/26-27/000001',
  date: '2026-10-05',
  againstInvoice: null,
  buyerName: 'Fixture Learner',
  buyerCompany: null,
  buyerGstin: null,
  placeOfSupplyCode: '29',
  placeOfSupplyName: 'Karnataka',
  supplyType: 'B2C',
  sac: '999293',
  currency: 'INR',
  taxableMinor: 211_822,
  cgstMinor: 0,
  sgstMinor: 0,
  igstMinor: 38_128,
  totalMinor: 249_950,
  orderReference: 'crs_fixture_1',
}

function get(query = '?month=2026-10') {
  return GET(new Request(`https://seanshore.example/api/admin/tax/documents${query}`))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePlatformAdministratorUser.mockResolvedValue({ id: 'admin-1' })
  mocks.listGstDocumentsForMonth.mockResolvedValue([row])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/admin/tax/documents', () => {
  it('answers a router prefetch or a browser speculative prefetch with an empty 204 and audits nothing (owner 21 Nov)', async () => {
    for (const headers of [{ rsc: '1' }, { 'next-router-prefetch': '1' }, { 'sec-purpose': 'prefetch' }, { purpose: 'prefetch' }] as Record<string, string>[]) {
      const response = await GET(new Request('https://seanshore.example/api/admin/tax/documents?month=2026-10', { headers }))
      expect(response.status).toBe(204)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(await response.text()).toBe('')
    }
    expect(mocks.requirePlatformAdministratorUser).not.toHaveBeenCalled()
    expect(mocks.listGstDocumentsForMonth).not.toHaveBeenCalled()
    expect(mocks.recordPaymentAudit).not.toHaveBeenCalled()
    expect(mocks.client.query).not.toHaveBeenCalled()
  })

  it('refuses signed-out visitors and non-administrators before reading anything', async () => {
    mocks.requirePlatformAdministratorUser.mockRejectedValueOnce(new AwsAuthenticationRequiredError())
    expect((await get()).status).toBe(401)
    mocks.requirePlatformAdministratorUser.mockRejectedValueOnce(new Error('admin_forbidden'))
    const forbidden = await get()
    expect(forbidden.status).toBe(403)
    expect(forbidden.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.listGstDocumentsForMonth).not.toHaveBeenCalled()
    expect(mocks.recordPaymentAudit).not.toHaveBeenCalled()
  })

  it('asks for a valid month', async () => {
    expect((await get('')).status).toBe(400)
    expect((await get('?month=2026-13')).status).toBe(400)
    expect(mocks.listGstDocumentsForMonth).not.toHaveBeenCalled()
  })

  it('returns the month as a private CSV download and records the export', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="sea-n-shore-gst-documents-2026-10.csv"')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const body = new Uint8Array(await response.arrayBuffer())
    expect([...body.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = new TextDecoder().decode(body)
    expect(text).toContain('Invoice,SNS/26-27/000001,2026-10-05,,Fixture Learner,,,29,Karnataka,B2C,999293,INR,2118.22,0.00,0.00,381.28,2499.50,crs_fixture_1')
    expect(mocks.listGstDocumentsForMonth).toHaveBeenCalledWith(mocks.client, '2026-10')
    expect(mocks.recordPaymentAudit).toHaveBeenCalledWith(mocks.client, {
      actorType: 'admin',
      actorProfileId: 'admin-1',
      subjectType: 'tax_export',
      subjectId: '2026-10',
      action: 'gst_documents_exported',
      details: { rows: 1 },
    })
  })

  it('reports a failed export without details', async () => {
    mocks.listGstDocumentsForMonth.mockRejectedValueOnce(new Error('database down'))
    const response = await get()
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ ok: false })
  })
})
