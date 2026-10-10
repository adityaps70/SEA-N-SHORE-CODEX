import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  createMediaUploadUrl: vi.fn(),
  createMediaDownloadUrl: vi.fn(),
  deleteMediaObject: vi.fn(),
  headMediaObject: vi.fn(),
  readMediaObjectPrefix: vi.fn(),
}))

vi.mock('@/lib/aws/storage', () => storage)

import { createSellerInvoiceDownloadUrl, createSellerInvoiceUpload, verifySellerInvoiceUpload } from './seller-invoice-files'

const seller = { profileId: '44444444-4444-4444-8444-444444444444' }
const path = `seller-invoices/profile-${seller.profileId}/2026-09/0b5c1d6e-1111-4222-8333-444455556666.pdf`
const pdf = new TextEncoder().encode('%PDF-1.7\n')

beforeEach(() => {
  vi.clearAllMocks()
  storage.createMediaUploadUrl.mockResolvedValue('https://bucket.example/put')
  storage.headMediaObject.mockResolvedValue({ contentType: 'application/pdf', contentLength: 2048 })
  storage.readMediaObjectPrefix.mockResolvedValue(pdf)
})

describe('seller invoice files', () => {
  it('signs a five-minute upload under the seller’s folder for the month', async () => {
    const upload = await createSellerInvoiceUpload({ seller, period: '2026-09', name: 'invoice.pdf', mimeType: 'application/pdf', size: 2048 })
    expect(upload.storagePath).toMatch(new RegExp(`^seller-invoices/profile-${seller.profileId}/2026-09/[0-9a-f-]{36}\\.pdf$`))
    expect(storage.createMediaUploadUrl).toHaveBeenCalledWith({ key: upload.storagePath, contentType: 'application/pdf' }, 300)
    await expect(createSellerInvoiceUpload({ seller, period: '2026-09', name: 'x.exe', mimeType: 'application/x-msdownload', size: 10 })).rejects.toMatchObject({ sellerMessage: expect.stringMatching(/PDF, JPG, PNG or WebP/) })
  })

  it('accepts a real PDF uploaded where it was told to go', async () => {
    expect(await verifySellerInvoiceUpload({ seller, period: '2026-09', storagePath: path, name: 'invoice.pdf', mimeType: 'application/pdf', size: 2048 }))
      .toEqual({ storagePath: path, fileName: 'invoice.pdf', contentType: 'application/pdf', sizeBytes: 2048 })
  })

  it('refuses another seller’s path without touching storage, and deletes a file that is not what it claims', async () => {
    await expect(verifySellerInvoiceUpload({ seller: { profileId: '66666666-6666-4666-8666-666666666666' }, period: '2026-09', storagePath: path, name: 'invoice.pdf', mimeType: 'application/pdf', size: 2048 }))
      .rejects.toMatchObject({ sellerMessage: expect.stringMatching(/not uploaded for this invoice/) })
    expect(storage.headMediaObject).not.toHaveBeenCalled()

    storage.readMediaObjectPrefix.mockResolvedValue(new TextEncoder().encode('MZ not a pdf'))
    await expect(verifySellerInvoiceUpload({ seller, period: '2026-09', storagePath: path, name: 'invoice.pdf', mimeType: 'application/pdf', size: 2048 }))
      .rejects.toMatchObject({ sellerMessage: expect.stringMatching(/isn’t really a PDF/) })
    expect(storage.deleteMediaObject).toHaveBeenCalledWith(path)

    storage.headMediaObject.mockResolvedValue({ contentType: 'application/pdf', contentLength: 999 })
    await expect(verifySellerInvoiceUpload({ seller, period: '2026-09', storagePath: path, name: 'invoice.pdf', mimeType: 'application/pdf', size: 2048 }))
      .rejects.toMatchObject({ sellerMessage: expect.stringMatching(/doesn’t match/) })
  })

  it('downloads as an attachment through a five-minute URL', async () => {
    storage.createMediaDownloadUrl.mockResolvedValue('https://bucket.example/get')
    expect(await createSellerInvoiceDownloadUrl({ storagePath: path, fileName: 'invoice.pdf', contentType: 'application/pdf' })).toBe('https://bucket.example/get')
    expect(storage.createMediaDownloadUrl).toHaveBeenCalledWith({ key: path, contentType: 'application/pdf', contentDisposition: expect.stringMatching(/^attachment; filename="invoice.pdf"/), expiresInSeconds: 300 })
  })
})
