import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getSellerInvoice: vi.fn(),
  canManageSeller: vi.fn(),
  canUsePlatformAdminAuthority: vi.fn(),
  createSellerInvoiceDownloadUrl: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => {
  class AwsAuthenticationRequiredError extends Error {}
  return { requireAwsUser: mocks.requireAwsUser, AwsAuthenticationRequiredError }
})
vi.mock('@/features/admin/mfa-gate', () => ({ canUsePlatformAdminAuthority: mocks.canUsePlatformAdminAuthority }))
vi.mock('@/features/payouts/payout-runtime', () => ({ readClient: {} }))
vi.mock('@/features/payouts/payout-repository', () => ({ canManageSeller: mocks.canManageSeller }))
vi.mock('@/features/payouts/seller-invoices', () => ({ getSellerInvoice: mocks.getSellerInvoice }))
vi.mock('@/features/payouts/seller-invoice-files', () => ({ createSellerInvoiceDownloadUrl: mocks.createSellerInvoiceDownloadUrl }))

import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'
import { GET } from './route'

const invoiceId = '99999999-9999-4999-8999-999999999999'
const SELLER = { profileId: '44444444-4444-4444-8444-444444444444' }
const invoice = { id: invoiceId, seller: SELLER, storagePath: `seller-invoices/profile-${SELLER.profileId}/2026-09/x.pdf`, fileName: 'invoice.pdf', contentType: 'application/pdf' }
const request = new Request(`https://seanshore.in/api/payouts/seller-invoices/${invoiceId}`)
const params = (id = invoiceId) => ({ params: Promise.resolve({ invoiceId: id }) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'viewer-1' })
  mocks.getSellerInvoice.mockResolvedValue(invoice)
  mocks.canManageSeller.mockResolvedValue(false)
  mocks.canUsePlatformAdminAuthority.mockResolvedValue(false)
  mocks.createSellerInvoiceDownloadUrl.mockResolvedValue('https://bucket.example/signed?X-Amz-Expires=300')
})

describe('GET /api/payouts/seller-invoices/[invoiceId]', () => {
  it('redirects the seller to a five-minute signed URL and never caches it', async () => {
    mocks.canManageSeller.mockResolvedValue(true)
    const response = await GET(request, params())
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://bucket.example/signed?X-Amz-Expires=300')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(mocks.canManageSeller).toHaveBeenCalledWith(expect.anything(), 'viewer-1', SELLER)
    expect(mocks.createSellerInvoiceDownloadUrl).toHaveBeenCalledWith(invoice)
  })

  it('lets a platform administrator with admin MFA open it', async () => {
    mocks.canUsePlatformAdminAuthority.mockResolvedValue(true)
    expect((await GET(request, params())).status).toBe(302)
    expect(mocks.canUsePlatformAdminAuthority).toHaveBeenCalledWith('viewer-1')
  })

  it('answers 404 to anyone else, to unknown invoices and to malformed ids, without signing a URL', async () => {
    expect((await GET(request, params())).status).toBe(404)
    mocks.getSellerInvoice.mockResolvedValue(null)
    expect((await GET(request, params())).status).toBe(404)
    expect((await GET(request, params('../etc/passwd'))).status).toBe(404)
    expect(mocks.createSellerInvoiceDownloadUrl).not.toHaveBeenCalled()
  })

  it('asks signed-out visitors to sign in', async () => {
    mocks.requireAwsUser.mockRejectedValue(new AwsAuthenticationRequiredError())
    expect((await GET(request, params())).status).toBe(401)
    expect(mocks.getSellerInvoice).not.toHaveBeenCalled()
  })
})
