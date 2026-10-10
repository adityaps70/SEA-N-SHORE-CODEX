import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdministratorUser: vi.fn(),
  listTdsReportRows: vi.fn(),
  recordPaymentAudit: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => ({
  AwsAuthenticationRequiredError: class AwsAuthenticationRequiredError extends Error {},
}))
vi.mock('@/features/admin/access', () => ({ requirePlatformAdministratorUser: mocks.requirePlatformAdministratorUser }))
vi.mock('@/features/payments/audit', () => ({ recordPaymentAudit: mocks.recordPaymentAudit }))
vi.mock('@/features/payouts/payout-runtime', () => ({ readClient: { query: vi.fn() } }))
vi.mock('@/features/payouts/tds-report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/payouts/tds-report')>()),
  listTdsReportRows: mocks.listTdsReportRows,
}))

import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'
import { GET } from './route'

const row = {
  payoutId: '77777777-7777-4777-8777-777777777777',
  transferId: 'snsp_77777777777747778777777777777777',
  createdAt: '2026-09-30T20:00:00.000Z', // 1 October 2026 in India
  sellerName: '=Fixture Seller',
  sellerType: 'Individual',
  pan: 'ABCDE1234F',
  section: '194J',
  rateBasisPoints: 1000,
  tdsBaseMinor: 180_000,
  tdsMinor: 16_200,
  grossMinor: 180_000,
  netMinor: 163_800,
  status: 'success',
  financialYear: '2026-27',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePlatformAdministratorUser.mockResolvedValue({ id: 'admin-1' })
  mocks.listTdsReportRows.mockResolvedValue([row])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/admin/tax/tds', () => {
  it('refuses signed-out visitors and non-administrators before reading any data', async () => {
    mocks.requirePlatformAdministratorUser.mockRejectedValueOnce(new AwsAuthenticationRequiredError())
    expect((await GET(new Request('https://seanshore.example/api/admin/tax/tds?month=2026-10'))).status).toBe(401)
    mocks.requirePlatformAdministratorUser.mockRejectedValueOnce(new Error('admin_forbidden'))
    const forbidden = await GET(new Request('https://seanshore.example/api/admin/tax/tds?month=2026-10'))
    expect(forbidden.status).toBe(403)
    await expect(forbidden.json()).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/Only Sea N Shore administrators/) })
    expect(mocks.listTdsReportRows).not.toHaveBeenCalled()
  })

  it('needs a YYYY-MM month', async () => {
    for (const month of ['', '2026-13', '2026-9', 'september']) {
      const response = await GET(new Request(`https://seanshore.example/api/admin/tax/tds?month=${month}`))
      expect(response.status).toBe(400)
    }
    expect(mocks.listTdsReportRows).not.toHaveBeenCalled()
  })

  it('exports the month as CSV (BOM, CRLF, formula-safe cells) and audits the export without personal data', async () => {
    const response = await GET(new Request('https://seanshore.example/api/admin/tax/tds?month=2026-10'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="sea-n-shore-tds-2026-10.csv"')
    const bytes = new Uint8Array(await response.clone().arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = await response.text()
    const [header, line] = text.replace(/^﻿/, '').split('\r\n')
    expect(header).toBe('Payout date,Payout ID,Transfer ID,Seller name,Seller type,PAN,Section,Rate %,Course amount (TDS base),TDS deducted,Gross paid,Net transferred,Status,Financial year')
    expect(line).toBe(`2026-10-01,${row.payoutId},${row.transferId},'=Fixture Seller,Individual,ABCDE1234F,194J,10,1800.00,162.00,1800.00,1638.00,Paid,2026-27`)
    expect(text.endsWith('\r\n')).toBe(true)
    expect(mocks.listTdsReportRows).toHaveBeenCalledWith(expect.anything(), '2026-10')
    expect(mocks.recordPaymentAudit).toHaveBeenCalledWith(expect.anything(), {
      actorType: 'admin', actorProfileId: 'admin-1', subjectType: 'tax_export', subjectId: '2026-10', action: 'tds_report_exported', details: { rows: 1 },
    })
  })

  it('says so when the export fails, without logging any row', async () => {
    mocks.listTdsReportRows.mockRejectedValueOnce(new Error('ABCDE1234F boom'))
    const response = await GET(new Request('https://seanshore.example/api/admin/tax/tds?month=2026-10'))
    expect(response.status).toBe(500)
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain('ABCDE1234F')
  })
})
