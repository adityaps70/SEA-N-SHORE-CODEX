import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  headMediaObject: vi.fn(),
  deleteMediaObject: vi.fn(async () => undefined),
  createMediaUploadUrl: vi.fn(),
  verifyStoredUploadSignature: vi.fn<(key: string, mimeType: string, size: number) => Promise<'match' | 'mismatch' | 'unavailable'>>(),
}))

vi.mock('@/lib/aws/storage', () => ({
  headMediaObject: mocks.headMediaObject,
  deleteMediaObject: mocks.deleteMediaObject,
  createMediaUploadUrl: mocks.createMediaUploadUrl,
}))
vi.mock('@/lib/uploads/verify-stored-upload', () => ({ verifyStoredUploadSignature: mocks.verifyStoredUploadSignature }))

import { JOB_APPLICATION_CV_NOT_PDF } from './application-media-policy'
import { verifyPendingJobApplicationCv } from './application-media'

const profileId = '11111111-1111-4111-8111-111111111111'
const jobId = '22222222-2222-4222-8222-222222222222'
const storagePath = `job-applications/${profileId}/${jobId}/33333333-3333-4333-8333-333333333333.pdf`
const input = { profileId, jobId, storagePath, fileName: 'cv.pdf', mimeType: 'application/pdf' as const, sizeBytes: 2048 }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headMediaObject.mockResolvedValue({ contentType: 'application/pdf', contentLength: 2048 })
})

describe('CV uploads must really be PDFs (Round P3)', () => {
  it('accepts a stored file whose bytes are a PDF', async () => {
    mocks.verifyStoredUploadSignature.mockResolvedValue('match')
    await expect(verifyPendingJobApplicationCv(input)).resolves.toMatchObject({ storagePath, mimeType: 'application/pdf' })
    expect(mocks.verifyStoredUploadSignature).toHaveBeenCalledWith(storagePath, 'application/pdf', 2048)
  })

  it('deletes and refuses a renamed file that is not a PDF', async () => {
    mocks.verifyStoredUploadSignature.mockResolvedValue('mismatch')
    await expect(verifyPendingJobApplicationCv(input)).rejects.toThrow(JOB_APPLICATION_CV_NOT_PDF)
    expect(mocks.deleteMediaObject).toHaveBeenCalledWith(storagePath)
  })
})
